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
const vragenbank = require('./vragen');
const { pastBijTitel } = require('../lib/trackcheck');
const logger = require('../lib/logger');

const RONDE_DUUR_MS = 30000; // standaard: 30 seconden raden
// 'Heel nummer': ruime bovengrens; de ronde eindigt zodra iedereen geraden
// heeft, of als deze tijd verstrijkt.
const HEEL_NUMMER_MS = 5 * 60 * 1000;

/** Bepaal de rondeduur uit de lobby-instellingen. */
function rondeDuurUit(instellingen) {
    const s = Number(instellingen && instellingen.speeltijd);
    if (s === 0) return HEEL_NUMMER_MS; // heel nummer
    if (Number.isFinite(s) && s >= 10 && s <= 300) return s * 1000;
    return RONDE_DUUR_MS;
}

/**
 * Spelmodus:
 * - 'snelste': de eerste met het juiste antwoord wint de ronde; die is
 *   daarmee meteen afgelopen.
 * - 'kenner': iedereen mag blijven raden tot de host op 'Volgende' klikt.
 *   Er telt dan niets af.
 */
function modusUit(instellingen) {
    return instellingen && instellingen.modus === 'kenner' ? 'kenner' : 'snelste';
}
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
                    t.land, t.genres, t.tmdb_id, t.poster_pad, t.omschrijving
               FROM titels t
               ${where ? where + ' AND' : 'WHERE'}
                    EXISTS (SELECT 1 FROM tracks tr
                              WHERE tr.titel_id = t.id
                                AND tr.werkt = true
                                AND tr.preview_url IS NOT NULL
                                AND tr.preview_url <> '')`,
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
            rondeDuurMs: rondeDuurUit(instellingen),
            modus: modusUit(instellingen),
            pool: pool_,
            totaalRondes: totaal,
            rondenummer: 0,
            voorraad,
            // Vraag-id's die in dit spel al gebruikt zijn, zodat dezelfde
            // titel niet twee keer dezelfde bonusvraag geeft.
            gebruikteVragen: new Set(),
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
        // Kies de BESTE track, niet een willekeurige. Playlist-tracks
        // YouTube is de hoofdbron voor intro's. iTunes is alleen fallback;
        // lokale bestanden staan ertussen voor later expliciet eigen audio.
        // Binnen die bronvolgorde winnen verificatie en foutvrije tracks.
        const { rows } = await pool.query(
            `SELECT tr.id, tr.bron, tr.preview_url, tr.start_seconde,
                    tr.tracknaam, tr.artiest, tr.album,
                    tr.verificatie_score, tr.verificatie_reden
               FROM tracks tr
              WHERE tr.titel_id = $1
                AND tr.werkt = true
                AND tr.preview_url IS NOT NULL
                AND tr.preview_url <> ''
              ORDER BY CASE
                           WHEN tr.bron = 'youtube' THEN 3
                           WHEN tr.bron = 'lokaal' THEN 2
                           ELSE 1
                       END DESC,
                       tr.verificatie_score DESC,
                       tr.fout_aantal ASC,
                       tr.herkenbaarheid DESC,
                       tr.id DESC
              LIMIT 5`,
            [titel.id],
        );

        // Laatste slot op de deur: speel nooit muziek die niet bij deze
        // titel hoort. Zo'n track wordt meteen afgekeurd, zodat hij ook in
        // volgende spellen niet meer voorbijkomt.
        let track = null;
        for (const kandidaat of rows) {
            if (pastBijTitel(titel, kandidaat).past) {
                track = kandidaat;
                break;
            }
            logger.waarschuwing('Track past niet bij de titel, afgekeurd.', {
                titel: titel.naam,
                tracknaam: kandidaat.tracknaam,
            });
            // Bewust awaiten: de afkeuring moet vaststaan, anders komt deze
            // verkeerde track in een volgend spel opnieuw voorbij.
            await pool
                .query(
                    `UPDATE tracks SET werkt = false, gecontroleerd = false,
                            verificatie_score = 0,
                            verificatie_reden = $2,
                            laatst_gecontroleerd_op = now()
                      WHERE id = $1`,
                    [kandidaat.id, 'afgekeurd tijdens speelcontrole'],
                )
                .catch(() => {});
        }

        if (!track) {
            // Alle tracks van deze titel zijn afgekeurd: sla de ronde over.
            logger.waarschuwing('Titel zonder werkende track, overgeslagen.', {
                titel: titel.naam,
            });
            state.rondenummer -= 1;
            state.pool.splice(state.rondenummer, 1);
            if (state.pool.length === 0) return this.eindigSpel(state);
            state.totaalRondes = Math.min(state.totaalRondes, state.pool.length);
            return this.volgendeRonde(state);
        }

        const rondeRij = await pool.query(
            `INSERT INTO rondes
               (lobby_id, rondenummer, titel_id, track_id, start_ms, duur_ms, status)
             VALUES ($1, $2, $3, $4, 0, $5, 'raden')
             RETURNING id`,
            [state.lobbyId, state.rondenummer, titel.id, track.id, state.rondeDuurMs],
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

        // Spelers: geen titel, geen audio-URL. In kennersmodus telt er niets
        // af — de host bepaalt wanneer de ronde voorbij is.
        this.io.to(kamer(state.code)).emit('ronde:start', {
            rondeId: state.huidige.rondeId,
            rondenummer: state.rondenummer,
            totaal: state.totaalRondes,
            durationMs: state.modus === 'kenner' ? null : state.rondeDuurMs,
            modus: state.modus,
        });
        // Host: krijgt de audio om af te spelen in de kamer. Afhankelijk van
        // de bron speelt de host een YouTube-video of audio-clip (lokaal/
        // iTunes-fallback) af, met de visualizer eroverheen.
        this.io.to(hostKamer(state.code)).emit('ronde:audio', {
            rondeId: state.huidige.rondeId,
            bron: track.bron,
            url: track.preview_url,
            startSeconde: track.start_seconde || 0,
            durationMs: state.rondeDuurMs,
        });

        // Bijhouden hoe vaak en wanneer deze track gespeeld is.
        pool.query(
            `UPDATE tracks SET keer_gespeeld = keer_gespeeld + 1,
                    laatst_gespeeld = now() WHERE id = $1`,
            [track.id],
        ).catch(() => {});

        // In kennersmodus loopt er geen klok: de host klikt op 'Volgende'.
        if (state.modus !== 'kenner') {
            state.huidige.timer = setTimeout(
                () => this.onthulEnBonus(state),
                state.rondeDuurMs,
            );
        }
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

            // Snelste-modus: de eerste met het juiste antwoord wint de ronde.
            // Kennersmodus: iedereen mag doorgaan tot de host verder klikt.
            if (state.modus === 'snelste') {
                this.io.to(kamer(state.code)).emit('ronde:gewonnen', {
                    spelerId,
                });
                this.onthulEnBonus(state);
            } else if (await this.iedereenKlaar(state)) {
                // Iedereen heeft het goed: dan hoeft de host niet te wachten.
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

        // Titel onthullen (de gokfase is voorbij), met alle informatie.
        this.io.to(kamer(state.code)).emit('ronde:onthul', {
            antwoord: this.antwoordInfo(h),
        });

        // Bonusvraag: eerst uit de eigen vragenbank (meerdere vragen per
        // titel, dus variatie), anders live via TMDB, anders geen bonus.
        let vraagTekst = null;
        let opties = null;
        let correctIndex = -1;
        let soort = null;

        try {
            // Zorg dat deze titel vragen heeft (genereert ze indien nodig).
            await vragenbank.vulAan(h.titel, 3, false);
            const uitBank = await vragenbank.haalVraag(
                h.titel.id,
                state.gebruikteVragen,
            );
            if (uitBank) {
                state.gebruikteVragen.add(uitBank.id);
                vraagTekst = uitBank.vraag;
                opties = uitBank.opties;
                correctIndex = uitBank.correctIndex;
                soort = uitBank.soort;
            }
        } catch (err) {
            logger.waarschuwing('Vragenbank niet beschikbaar.', {
                melding: err.message,
            });
        }

        if (!vraagTekst) {
            const bonus = await genereerBonus(h.titel);
            if (!bonus) {
                return this.naarScorebord(state);
            }
            vraagTekst = bonus.vraag;
            opties = bonus.opties.map((o) => o.tekst);
            correctIndex = bonus.opties.findIndex((o) => o.correct);
            soort = bonus.type;
        }

        h.bonus = {
            correctIndex,
            pogingen: new Map(), // spelerId -> aantal pogingen
            klaar: new Set(), // spelers die klaar zijn (goed of op)
            type: soort,
        };
        state.fase = 'bonus';

        await pool.query(`UPDATE rondes SET bonusvraag = $2::jsonb WHERE id = $1`, [
            h.rondeId,
            JSON.stringify({ vraag: vraagTekst, type: soort }),
        ]);

        // Alleen de vraag en de opties naar de clients — nooit het antwoord.
        this.io.to(kamer(state.code)).emit('ronde:bonus', {
            vraag: vraagTekst,
            opties,
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

    // ---- Host-acties ----

    /** Host klikt op 'Volgende': gokfase afronden en door. */
    async volgende(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || !socket.data.isHost) return;
        if (state.fase === 'raden') return this.onthulEnBonus(state);
        if (state.fase === 'bonus') return this.eindBonus(state);
        if (state.fase === 'onthul' || state.fase === 'scorebord') {
            return this.volgendeRonde(state);
        }
    }

    /** Host pauzeert: klok stilzetten en de muziek stoppen. */
    pauzeer(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || !socket.data.isHost || !state.huidige) return;
        const h = state.huidige;
        if (h.gepauzeerd) return;

        if (h.timer) {
            clearTimeout(h.timer);
            h.timer = null;
        }
        // Bewaar hoeveel tijd er nog over was.
        h.restMs = Math.max(0, h.startTijd + state.rondeDuurMs - Date.now());
        h.gepauzeerdOp = Date.now();
        h.gepauzeerd = true;

        this.io.to(kamer(state.code)).emit('ronde:pauze', { gepauzeerd: true });
        this.io.to(hostKamer(state.code)).emit('ronde:audio-pauze', {});
    }

    /** Host hervat: klok weer laten lopen en de muziek verder spelen. */
    hervat(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || !socket.data.isHost || !state.huidige) return;
        const h = state.huidige;
        if (!h.gepauzeerd) return;

        // Schuif de starttijd op met de duur van de pauze, zodat de
        // puntentelling geen pauzetijd meerekent.
        const pauzeDuur = Date.now() - h.gepauzeerdOp;
        h.startTijd += pauzeDuur;
        h.gepauzeerd = false;
        h.gepauzeerdOp = null;

        if (state.modus !== 'kenner' && h.restMs > 0) {
            h.timer = setTimeout(() => this.onthulEnBonus(state), h.restMs);
        }

        this.io.to(kamer(state.code)).emit('ronde:pauze', {
            gepauzeerd: false,
            startTs: Date.now(),
            restMs: h.restMs,
        });
        this.io.to(hostKamer(state.code)).emit('ronde:audio-hervat', {});
    }

    /** Host klikt op 'Opnieuw afspelen': stuurt de audio nogmaals. */
    herhaal(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || !socket.data.isHost || !state.huidige) return;
        const { track, rondeId } = state.huidige;
        this.io.to(hostKamer(state.code)).emit('ronde:audio', {
            rondeId,
            bron: track.bron,
            url: track.preview_url,
            startSeconde: track.start_seconde || 0,
            durationMs: state.rondeDuurMs,
            herhaling: Date.now(), // maakt het event uniek
        });
    }

    /**
     * Een speler of de host meldt dat er iets mis is met de muziek van de
     * huidige ronde. Zo hoeft niemand de hele database na te lopen: in
     * /admin verschijnt een lijst met meldingen.
     */
    async meldFout(socket, soort, toelichting) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || !state.huidige) return;
        const geldig = ['fout', 'geen_geluid', 'verkeerd_nummer', 'anders'];
        const soortSchoon = geldig.includes(soort) ? soort : 'fout';

        await pool.query(
            `INSERT INTO meldingen (track_id, titel_id, soort, toelichting)
             VALUES ($1, $2, $3, $4)`,
            [
                state.huidige.track.id,
                state.huidige.titel.id,
                soortSchoon,
                toelichting ? String(toelichting).slice(0, 500) : null,
            ],
        );
        // Deze track zakt in de rangorde; bij drie meldingen wordt hij niet
        // meer gespeeld. Zo verdwijnen slechte nummers automatisch.
        const bij = await pool.query(
            `UPDATE tracks
                SET fout_aantal = fout_aantal + 1,
                    -- Een expliciete melding "verkeerd nummer" is direct
                    -- genoeg bewijs om deze track niet opnieuw te spelen.
                    werkt = CASE
                        WHEN $2 = 'verkeerd_nummer' THEN false
                        ELSE (fout_aantal + 1) < 3
                    END
              WHERE id = $1
              RETURNING fout_aantal, werkt`,
            [state.huidige.track.id, soortSchoon],
        );
        logger.info('Melding ontvangen.', {
            code: state.code,
            titel: state.huidige.titel.naam,
            soort: soortSchoon,
            fout_aantal: bij.rows[0] && bij.rows[0].fout_aantal,
            nog_bruikbaar: bij.rows[0] && bij.rows[0].werkt,
        });
        this.io
            .to(spelerKamer(socket.data.spelerId))
            .emit('ronde:melding-ok', { soort: soortSchoon });
    }

    // ---- Hulp ----

    /** Volledige informatie over het antwoord (na afloop van de gokfase). */
    antwoordInfo(h) {
        return {
            naam: h.titel.naam,
            jaar: h.titel.jaar,
            type: h.titel.type, // film of serie
            taal: h.titel.taal, // nl of internationaal
            land: h.titel.land,
            genres: h.titel.genres || [],
            // Poster en korte omschrijving (uit TMDB) voor het eindbeeld.
            poster: h.titel.poster_pad
                ? `https://image.tmdb.org/t/p/w342${h.titel.poster_pad}`
                : null,
            omschrijving: h.titel.omschrijving || null,
            tracknaam: h.track.tracknaam,
            artiest: h.track.artiest,
            trackId: h.track.id,
            titelId: h.titel.id,
        };
    }

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
