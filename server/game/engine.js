// =====================================================================
// Game-engine: rondestate, timers en scoring. De server is de bron van
// waarheid. Clients krijgen nooit de titel voor de ronde is afgelopen —
// alleen de host krijgt de audio-URL (die verraadt de titel niet).
//
// Fases per ronde: 'raden' → (bonus, stap 7) → 'scorebord' → volgende.
// =====================================================================

const { pool } = require('../db/pool');
const { bouwFilter } = require('./filters');
const { vergelijk } = require('../lib/match');
const { titelPunten, bonusPunten } = require('./scoring');
const { genereerBonus } = require('./bonus');
const logger = require('../lib/logger');

const RONDE_DUUR_MS = 30000; // 30 seconden raden
const BONUS_DUUR_MS = 15000; // 15 seconden voor de bonusvraag
const SCOREBORD_PAUZE_MS = 7000; // pauze tussen rondes
const GOK_INTERVAL_MS = 1000; // max 1 gok per seconde per speler

function kamer(code) {
    return `lobby:${code}`;
}
function hostKamer(code) {
    return `host:${code}`;
}
function spelerKamer(id) {
    return `speler:${id}`;
}

function husselArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

class SpelBeheer {
    constructor(io) {
        this.io = io;
        this.spellen = new Map(); // lobbyId -> state
    }

    heeftSpel(lobbyId) {
        return this.spellen.has(lobbyId);
    }

    // ---- Spel starten ----
    async startSpel({ lobbyId, code, instellingen }) {
        if (this.spellen.has(lobbyId)) return;

        const { where, params } = bouwFilter(instellingen || {});
        const { rows: titels } = await pool.query(
            `SELECT t.id, t.naam, t.aliassen, t.type, t.taal, t.jaar,
                    t.land, t.genres, t.tmdb_id
               FROM titels t
               ${where ? where + ' AND' : 'WHERE'}
                    EXISTS (SELECT 1 FROM tracks tr WHERE tr.titel_id = t.id)`,
            params,
        );

        if (titels.length === 0) {
            this.io.to(kamer(code)).emit('spel:fout', {
                melding: 'Geen speelbare titels met deze filters.',
            });
            return;
        }

        const gevraagd = Number(instellingen?.rondes) || 0; // 0 = eindeloos
        const pool_ = husselArray(titels);
        const totaal = gevraagd > 0 ? Math.min(gevraagd, pool_.length) : pool_.length;

        const { rows: spelers } = await pool.query(
            `SELECT id FROM spelers WHERE lobby_id = $1`,
            [lobbyId],
        );
        const voorraad = new Map();
        for (const s of spelers) voorraad.set(s.id, 3); // 3 hints per speler

        const state = {
            lobbyId,
            code,
            instellingen,
            pool: pool_,
            totaalRondes: totaal,
            rondenummer: 0,
            voorraad,
            fase: 'wachten',
            huidige: null,
        };
        this.spellen.set(lobbyId, state);

        await pool.query(
            `UPDATE lobbies SET status = 'bezig', huidige_ronde = 0 WHERE id = $1`,
            [lobbyId],
        );
        logger.info('Spel gestart.', { code, totaal });

        await this.volgendeRonde(state);
    }

    // ---- Volgende ronde ----
    async volgendeRonde(state) {
        state.rondenummer += 1;
        if (state.rondenummer > state.totaalRondes) {
            return this.eindigSpel(state);
        }

        // Hintvoorraad aanvullen: +1 per 10 gespeelde vragen.
        if (state.rondenummer > 1 && (state.rondenummer - 1) % 10 === 0) {
            for (const id of state.voorraad.keys()) {
                state.voorraad.set(id, state.voorraad.get(id) + 1);
            }
        }

        const titel = state.pool[state.rondenummer - 1];
        const { rows } = await pool.query(
            `SELECT id, preview_url, tracknaam, artiest
               FROM tracks WHERE titel_id = $1 ORDER BY random() LIMIT 1`,
            [titel.id],
        );
        const track = rows[0];

        const rondeRij = await pool.query(
            `INSERT INTO rondes
               (lobby_id, rondenummer, titel_id, track_id, start_ms, duur_ms, status)
             VALUES ($1, $2, $3, $4, 0, $5, 'raden')
             RETURNING id`,
            [state.lobbyId, state.rondenummer, titel.id, track.id, RONDE_DUUR_MS],
        );

        state.huidige = {
            rondeId: rondeRij.rows[0].id,
            titel,
            track,
            startTijd: Date.now(),
            klaar: new Set(), // spelers die goed hebben
            hints: new Map(), // spelerId -> aantal hints deze ronde
            antwoorden: new Map(), // spelerId -> {punten, verstreken}
            laatsteGok: new Map(), // spelerId -> timestamp (rate limit)
            timer: null,
        };
        state.fase = 'raden';

        await pool.query(`UPDATE lobbies SET huidige_ronde = $1 WHERE id = $2`, [
            state.rondenummer,
            state.lobbyId,
        ]);

        // Spelers: geen titel, geen audio-URL.
        this.io.to(kamer(state.code)).emit('ronde:start', {
            rondeId: state.huidige.rondeId,
            rondenummer: state.rondenummer,
            totaal: state.totaalRondes,
            durationMs: RONDE_DUUR_MS,
        });
        // Host: krijgt de audio om af te spelen in de kamer.
        this.io.to(hostKamer(state.code)).emit('ronde:audio', {
            rondeId: state.huidige.rondeId,
            previewUrl: track.preview_url,
            startMs: 0,
            durationMs: RONDE_DUUR_MS,
        });

        state.huidige.timer = setTimeout(
            () => this.onthulEnBonus(state),
            RONDE_DUUR_MS,
        );
    }

    // ---- Gok verwerken ----
    async verwerkGok(socket, gok) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'raden' || !state.huidige) return;
        const spelerId = socket.data.spelerId;
        if (!spelerId) return;

        const h = state.huidige;
        if (h.klaar.has(spelerId)) return; // al goed

        // Rate limit: max 1 gok per seconde.
        const nu = Date.now();
        const vorige = h.laatsteGok.get(spelerId) || 0;
        if (nu - vorige < GOK_INTERVAL_MS) {
            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'tempo',
                melding: 'Rustig aan — één poging per seconde.',
            });
            return;
        }
        h.laatsteGok.set(spelerId, nu);

        const uitslag = vergelijk(gok, h.titel);

        if (uitslag.status === 'goed') {
            const verstreken = nu - h.startTijd;
            const hintsGebruikt = h.hints.get(spelerId) || 0;
            const punten = titelPunten(verstreken, hintsGebruikt);
            h.klaar.add(spelerId);
            h.antwoorden.set(spelerId, { punten, verstreken, hintsGebruikt });

            await this.slaAntwoordOp(state, spelerId, {
                titel_goed: true,
                hints_gebruikt: hintsGebruikt,
                verstreken_ms: verstreken,
                titel_punten: punten,
            });
            await this.telScoreOp(spelerId, punten);

            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'goed',
                punten,
            });
            await this.stuurScores(state);

            // Iedereen klaar? Dan de gokfase vroeg beëindigen.
            if (await this.iedereenKlaar(state)) {
                this.onthulEnBonus(state);
            }
        } else if (uitslag.status === 'bijna') {
            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'bijna',
                melding: 'Bijna! Probeer nog eens.',
            });
        } else {
            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'fout',
            });
        }
    }

    // ---- Hint ----
    async vraagHint(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'raden' || !state.huidige) return;
        const spelerId = socket.data.spelerId;
        const h = state.huidige;
        if (h.klaar.has(spelerId)) return;

        const gegeven = h.hints.get(spelerId) || 0;
        if (gegeven >= 3) {
            this.io
                .to(spelerKamer(spelerId))
                .emit('ronde:hint', { fout: 'Geen hints meer deze ronde.' });
            return;
        }
        const voorraad = state.voorraad.get(spelerId) || 0;
        if (voorraad <= 0) {
            this.io
                .to(spelerKamer(spelerId))
                .emit('ronde:hint', { fout: 'Je hintvoorraad is op.' });
            return;
        }

        const nr = gegeven + 1;
        h.hints.set(spelerId, nr);
        state.voorraad.set(spelerId, voorraad - 1);

        this.io.to(spelerKamer(spelerId)).emit('ronde:hint', {
            nr,
            ...this.bouwHint(nr, h.titel),
            kosten: 25,
            voorraad: voorraad - 1,
        });
    }

    bouwHint(nr, titel) {
        if (nr === 1) {
            return {
                type: 'jaar',
                tekst: `Jaar van uitgave: ${titel.jaar ?? 'onbekend'}`,
            };
        }
        if (nr === 2) {
            const genres = (titel.genres || []).join(', ') || 'onbekend genre';
            return {
                type: 'genre-land',
                tekst: `${genres} · ${titel.land || 'onbekend land'}`,
            };
        }
        const letters = String(titel.naam)
            .split(/\s+/)
            .map((w) => (w[0] ? w[0].toUpperCase() : ''))
            .join('. ');
        return { type: 'letters', tekst: `Beginletters: ${letters}.` };
    }

    // ---- Gokfase beëindigen: titel onthullen en (optioneel) bonusvraag ----
    async onthulEnBonus(state) {
        const h = state.huidige;
        if (!h || state.fase !== 'raden') return;
        if (h.timer) clearTimeout(h.timer);
        h.timer = null;
        state.fase = 'onthul';

        await pool.query(`UPDATE rondes SET status = 'bonus' WHERE id = $1`, [
            h.rondeId,
        ]);

        // Titel onthullen (de gokfase is voorbij).
        this.io.to(kamer(state.code)).emit('ronde:onthul', {
            antwoord: {
                naam: h.titel.naam,
                jaar: h.titel.jaar,
                tracknaam: h.track.tracknaam,
                artiest: h.track.artiest,
            },
        });

        // Bonusvraag proberen te genereren (valt terug op geen bonus).
        const bonus = await genereerBonus(h.titel);
        if (!bonus) {
            return this.naarScorebord(state);
        }

        const correctIndex = bonus.opties.findIndex((o) => o.correct);
        h.bonus = {
            correctIndex,
            pogingen: new Map(), // spelerId -> aantal pogingen
            klaar: new Set(), // spelers die klaar zijn (goed of op)
            type: bonus.type,
        };
        state.fase = 'bonus';

        await pool.query(`UPDATE rondes SET bonusvraag = $2::jsonb WHERE id = $1`, [
            h.rondeId,
            JSON.stringify({ vraag: bonus.vraag, type: bonus.type }),
        ]);

        // Opties zonder 'correct'-vlag naar de clients.
        this.io.to(kamer(state.code)).emit('ronde:bonus', {
            vraag: bonus.vraag,
            opties: bonus.opties.map((o) => o.tekst),
            durationMs: BONUS_DUUR_MS,
        });

        h.bonusTimer = setTimeout(() => this.eindBonus(state), BONUS_DUUR_MS);
    }

    // ---- Bonusantwoord verwerken ----
    async verwerkBonus(socket, keuze) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'bonus' || !state.huidige?.bonus) return;
        const spelerId = socket.data.spelerId;
        const b = state.huidige.bonus;
        if (b.klaar.has(spelerId)) return;

        const poging = (b.pogingen.get(spelerId) || 0) + 1;
        b.pogingen.set(spelerId, poging);

        const goed = Number(keuze) === b.correctIndex;
        if (goed) {
            const punten = bonusPunten(poging);
            b.klaar.add(spelerId);
            await this.telScoreOp(spelerId, punten);
            await this.werkBonusAntwoordBij(state, spelerId, {
                bonus_goed: true,
                bonus_pogingen: poging,
                bonus_punten: punten,
            });
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'goed',
                punten,
            });
            await this.stuurScores(state);
        } else if (poging >= 2) {
            // Tweede fout: klaar, geen punten.
            b.klaar.add(spelerId);
            await this.werkBonusAntwoordBij(state, spelerId, {
                bonus_goed: false,
                bonus_pogingen: poging,
                bonus_punten: 0,
            });
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'fout',
                correctIndex: b.correctIndex,
            });
        } else {
            // Eerste fout: nog één poging (halve punten).
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'nogmaals',
            });
        }

        if (await this.iedereenBonusKlaar(state)) {
            this.eindBonus(state);
        }
    }

    async eindBonus(state) {
        const h = state.huidige;
        if (h?.bonusTimer) clearTimeout(h.bonusTimer);
        if (h) h.bonusTimer = null;
        this.naarScorebord(state);
    }

    // ---- Scorebord tonen en door naar de volgende ronde ----
    async naarScorebord(state) {
        const h = state.huidige;
        if (!h) return;
        state.fase = 'scorebord';
        await pool.query(`UPDATE rondes SET status = 'afgelopen' WHERE id = $1`, [
            h.rondeId,
        ]);

        const scorebord = await this.haalScorebord(state);
        this.io.to(kamer(state.code)).emit('ronde:afgelopen', { scorebord });

        setTimeout(() => {
            if (this.spellen.get(state.lobbyId) === state) {
                this.volgendeRonde(state);
            }
        }, SCOREBORD_PAUZE_MS);
    }

    // ---- Spel beëindigen ----
    async eindigSpel(state) {
        state.fase = 'einde';
        await pool.query(`UPDATE lobbies SET status = 'afgelopen' WHERE id = $1`, [
            state.lobbyId,
        ]);
        const scorebord = await this.haalScorebord(state);
        this.io.to(kamer(state.code)).emit('spel:einde', { scorebord });
        this.spellen.delete(state.lobbyId);
        logger.info('Spel afgelopen.', { code: state.code });
    }

    // ---- Hulp ----
    async slaAntwoordOp(state, spelerId, velden) {
        await pool.query(
            `INSERT INTO antwoorden
               (ronde_id, speler_id, titel_goed, hints_gebruikt,
                verstreken_ms, titel_punten)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (ronde_id, speler_id) DO UPDATE SET
               titel_goed = EXCLUDED.titel_goed,
               hints_gebruikt = EXCLUDED.hints_gebruikt,
               verstreken_ms = EXCLUDED.verstreken_ms,
               titel_punten = EXCLUDED.titel_punten`,
            [
                state.huidige.rondeId,
                spelerId,
                velden.titel_goed,
                velden.hints_gebruikt,
                velden.verstreken_ms,
                velden.titel_punten,
            ],
        );
    }

    async telScoreOp(spelerId, punten) {
        await pool.query(`UPDATE spelers SET score = score + $1 WHERE id = $2`, [
            punten,
            spelerId,
        ]);
    }

    async werkBonusAntwoordBij(state, spelerId, velden) {
        // Er bestaat al een antwoordrij als de speler de titel goed had; zo
        // niet, dan maken we er één aan (deelnemer aan de bonus).
        await pool.query(
            `INSERT INTO antwoorden (ronde_id, speler_id, bonus_goed,
                                     bonus_pogingen, bonus_punten)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (ronde_id, speler_id) DO UPDATE SET
               bonus_goed = EXCLUDED.bonus_goed,
               bonus_pogingen = EXCLUDED.bonus_pogingen,
               bonus_punten = EXCLUDED.bonus_punten`,
            [
                state.huidige.rondeId,
                spelerId,
                velden.bonus_goed,
                velden.bonus_pogingen,
                velden.bonus_punten,
            ],
        );
    }

    async iedereenBonusKlaar(state) {
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM spelers
              WHERE lobby_id = $1 AND verbonden = true AND is_host = false`,
            [state.lobbyId],
        );
        return rows[0].n > 0 && state.huidige.bonus.klaar.size >= rows[0].n;
    }

    async iedereenKlaar(state) {
        // Alleen verbonden spelers (niet de host) hoeven te raden; de host
        // speelt de muziek. Zonder spelers eindigt de ronde via de timer.
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM spelers
              WHERE lobby_id = $1 AND verbonden = true AND is_host = false`,
            [state.lobbyId],
        );
        return rows[0].n > 0 && state.huidige.klaar.size >= rows[0].n;
    }

    async haalScorebord(state) {
        const { rows } = await pool.query(
            `SELECT id, naam, score, is_host FROM spelers
              WHERE lobby_id = $1 ORDER BY score DESC, naam ASC`,
            [state.lobbyId],
        );
        return rows;
    }

    async stuurScores(state) {
        const scorebord = await this.haalScorebord(state);
        this.io.to(kamer(state.code)).emit('spel:scores', scorebord);
    }
}

module.exports = { SpelBeheer, RONDE_DUUR_MS };
