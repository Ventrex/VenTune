// =====================================================================
// Game-engine: rondestate, timers en scoring. De server is de bron van
// waarheid. Clients krijgen nooit de titel voor de ronde is afgelopen —
// de host krijgt de audio-URL en mag tegelijk als speler meedoen.
//
// Fases per ronde: 'raden' → (bonus, stap 7) → 'scorebord' → volgende.
// =====================================================================

const { pool } = require('../db/pool');
const { bouwFilter } = require('./filters');
const { vergelijk } = require('../lib/match');
const { titelPunten, bonusPunten, leeftijdsFactor } = require('./scoring');
const { genereerBonus } = require('./bonus');
const vragenbank = require('./vragen');
const logger = require('../lib/logger');
const tmdb = require('../lib/tmdb');

const RONDE_DUUR_MS = 30000; // standaard: 30 seconden raden
// 'Heel nummer': ruime bovengrens; de ronde eindigt zodra iedereen geraden
// heeft, of als deze tijd verstrijkt.
const HEEL_NUMMER_MS = 5 * 60 * 1000;

/** Bepaal de rondeduur uit de lobby-instellingen. */
function rondeDuurUit(instellingen) {
    // Kinderen krijgen bewust twintig seconden om te lezen en te kiezen.
    // Dit staat los van de ingestelde fragmentduur; het spel blijft daarna
    // wel strikt lokaal afspelen.
    if (instellingen?.kindvriendelijk === true) return 20000;
    const s = Number(instellingen && instellingen.speeltijd);
    if (s === 0) return HEEL_NUMMER_MS; // heel nummer
    if (Number.isFinite(s) && s >= 10 && s <= 300) return s * 1000;
    // Oude lobbies zonder speeltijdinstelling vallen terug op het volledige
    // lokale fragment (maximaal vijf minuten), niet op een onverwachte 30s.
    return HEEL_NUMMER_MS;
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
const BONUS_COOLDOWN_MS = 5000; // na een fout krijgt iedereen denktijd
const SCOREBORD_PAUZE_MS = 7000; // pauze tussen rondes
const GOK_INTERVAL_MS = 1000; // max 1 gok per seconde per speler
const AANTAL_MEERKEUZE_OPTIES = 6;

function startSecondeVoorTrack(track) {
    // YouTube-downloads worden al vanaf start_seconde geknipt. Een lokaal
    // bestand begint daarom altijd op 0; nogmaals springen maakt het stil.
    if (track?.bron === 'lokaal') return 0;
    return Math.max(0, Number(track?.start_seconde) || 0);
}

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

function lifelineAantal(instellingen) {
    const rondes = Number(instellingen?.rondes) || 0;
    if (rondes <= 0) return 3;
    return Math.max(1, Math.floor(rondes / 10));
}

function antwoordModusUit(instellingen) {
    // Meerkeuze (zes opties) is de standaard; alleen wie bewust 'typen' kiest
    // krijgt een invulveld.
    return instellingen?.antwoord_modus === 'typen' ? 'typen' : 'meerkeuze';
}

function kindmodusUit(instellingen) {
    return instellingen?.kindvriendelijk === true;
}

/** Alleen een solo-speler krijgt een tweede titelgok. */
function maxTitelPogingen(state) {
    return state.solo ? 2 : 1;
}

function bouwMeerkeuzeOpties(titel, pool_) {
    const genres = new Set((titel.genres || []).map((g) => String(g).toLowerCase()));
    const zonderZelf = pool_.filter((t) => t.id !== titel.id);

    const taalOk = (t) => !titel.taal || !t.taal || t.taal === titel.taal;
    const genreOk = (t) => (t.genres || []).some((g) => genres.has(String(g).toLowerCase()));
    const typeOk = (t) => !titel.type || t.type === titel.type;
    const jaarBij = (t, marge) => !!titel.jaar && !!t.jaar
        && Math.abs(Number(t.jaar) - Number(titel.jaar)) <= marge;

    // Basis: alleen dezelfde taal. Levert dat te weinig op, dan telt alles.
    const zelfdeTaal = zonderZelf.filter(taalOk);
    const basis = zelfdeTaal.length >= AANTAL_MEERKEUZE_OPTIES - 1 ? zelfdeTaal : zonderZelf;

    const opties = [titel.naam];
    const gezien = new Set([String(titel.naam).toLowerCase()]);
    // Voeg tot `aantal` titels uit `lijst` toe (gehusseld, zonder dubbele),
    // maar nooit meer dan zes opties in totaal.
    const voegToe = (lijst, aantal) => {
        let over = aantal;
        for (const t of husselArray(lijst)) {
            if (over <= 0 || opties.length >= AANTAL_MEERKEUZE_OPTIES) break;
            const sleutel = String(t.naam).toLowerCase();
            if (gezien.has(sleutel)) continue;
            gezien.add(sleutel);
            opties.push(t.naam);
            over -= 1;
        }
    };

    // Samenstelling van de foute antwoorden. Voorbeeld: een Nederlandse comedy-
    // serie uit 1990 krijgt ~2 Nederlandse comedy's, ~2 Nederlandse titels van
    // hetzelfde type uit 1989–1991 en ~1 willekeurige Nederlandse titel. Zo
    // zijn de afleiders passend én wisselen ze per ronde.
    if (genres.size) voegToe(basis.filter(genreOk), 2);
    voegToe(basis.filter((t) => typeOk(t) && jaarBij(t, 1)), 2);
    // Jaarvenster stapsgewijs verruimen als 1990±1 te weinig opleverde.
    voegToe(basis.filter((t) => typeOk(t) && jaarBij(t, 3)), 2);
    voegToe(basis.filter((t) => typeOk(t) && jaarBij(t, 8)), 2);
    // Eén willekeurige zelfde-taal-titel en, als vangnet, elke resterende titel,
    // zodat er altijd zes opties zijn en de knoppen nooit verdwijnen.
    voegToe(basis, AANTAL_MEERKEUZE_OPTIES);
    voegToe(zonderZelf, AANTAL_MEERKEUZE_OPTIES);

    // Alleen als de hele pool te klein is (minder dan zes titels) lukt het niet.
    if (opties.length < AANTAL_MEERKEUZE_OPTIES) return null;
    const gehusseld = husselArray(opties);
    return {
        opties: gehusseld,
        correctIndex: gehusseld.findIndex((optie) => optie === titel.naam),
    };
}

/**
 * Bepaal of alle momenteel verbonden deelnemers klaar zijn. De host staat
 * bewust in deze verzameling: de host speelt audio af én mag zelf raden.
 * Pure helper zodat dit gedrag zonder database te testen blijft.
 */
function iedereenActiefKlaar(spelers, klaar) {
    const actieve = spelers.filter((speler) => speler.verbonden === true);
    return actieve.length > 0 && actieve.every((speler) => klaar.has(speler.id));
}

function beginLetters(naam) {
    return String(naam || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((woord) => {
            const letters = Array.from(woord);
            if (letters.length <= 2) return letters[0]?.toUpperCase() || '';
            const stippen = '.'.repeat(Math.max(3, Math.min(5, letters.length - 2)));
            return `${letters[0].toUpperCase()}${stippen}${letters[letters.length - 1].toLowerCase()}`;
        })
        .join(' ');
}

function bonusVraagPastPeriode(vraag, titel, instellingen = {}) {
    if (!['jaar', 'releasejaar'].includes(vraag?.soort)) return true;
    const jaar = Number(vraag?.opties?.[vraag.correctIndex]);
    const titelJaar = Number(titel?.jaar);
    const start = Number(instellingen.periode_start);
    const eind = Number(instellingen.periode_eind);
    if (!Number.isInteger(jaar) || !Number.isInteger(titelJaar)) return false;
    if (jaar !== titelJaar) return false;
    if (Number.isInteger(start) && jaar < start) return false;
    if (Number.isInteger(eind) && jaar > eind) return false;
    return true;
}

/**
 * Bouw verschillende, niet-spoilerende hints. Het jaartal is bewust een
 * reservehint en niet langer standaard hint nummer één.
 */
function bouwHinten(titel) {
    const hints = [];
    const rollen = Array.isArray(titel.hoofdrollen)
        ? titel.hoofdrollen.filter(Boolean).slice(0, 4)
        : [];
    const genres = Array.isArray(titel.genres) ? titel.genres.filter(Boolean) : [];

    if (rollen.length) {
        hints.push({ type: 'hoofdrollen', tekst: `Hoofdrollen: ${rollen.join(', ')}` });
    }
    if (titel.speelplek) {
        hints.push({ type: 'speelplek', tekst: `Speelt zich af in: ${titel.speelplek}` });
    }
    if (genres.length || titel.land) {
        const kenmerken = [];
        if (genres.length) kenmerken.push(`genre: ${genres.slice(0, 2).join(', ')}`);
        if (titel.land) kenmerken.push(`land van herkomst: ${titel.land}`);
        hints.push({ type: 'kenmerken', tekst: kenmerken.join(' · ') });
    }
    if (titel.naam) {
        hints.push({ type: 'letters', tekst: `Beginletters: ${beginLetters(titel.naam)}` });
    }
    if (titel.jaar !== null && titel.jaar !== undefined && titel.jaar !== ''
        && Number.isFinite(Number(titel.jaar))) {
        hints.push({ type: 'jaar', tekst: `Uitgekomen in: ${titel.jaar}` });
    }
    if (titel.type) {
        hints.push({
            type: 'type',
            tekst: `Het is een ${titel.type === 'serie' ? 'serie' : 'film'}.`,
        });
    }
    return hints;
}

/**
 * Verwijder een titel waarvoor tijdens het spel geen geldige track meer
 * bestaat. De huidige ronde telt dan niet mee. De volgende titel komt op
 * exact hetzelfde rondenummer, zodat een foutieve track nooit een ronde
 * overslaat of een nummering-gat veroorzaakt.
 */
function verwijderOnspeelbareTitel(state) {
    const index = state.rondenummer - 1;
    if (index < 0 || index >= state.pool.length) return false;

    state.pool.splice(index, 1);
    state.rondenummer -= 1;
    state.totaalRondes = Math.min(state.totaalRondes, state.pool.length);
    return state.pool.length > 0 && state.rondenummer < state.totaalRondes;
}

class SpelBeheer {
    constructor(io) {
        this.io = io;
        this.spellen = new Map(); // lobbyId -> state
    }

    heeftSpel(lobbyId) {
        return this.spellen.has(lobbyId);
    }

    /**
     * Stuur de actuele speltoestand nogmaals naar één socket.
     *
     * Socket.IO levert events niet af wanneer een telefoon/browser tijdelijk
     * geen verbinding heeft. De game-state leeft op de server, dus een
     * refresh of een handmatige herstelactie moet de speler weer op exact de
     * huidige fase zetten in plaats van terug te vallen naar de wachtruimte.
     */
    async herstelSocket(socket) {
        const state = this.spellen.get(socket.data?.lobbyId);
        if (!state || !socket.data?.code || state.code !== socket.data.code) return false;

        const h = state.huidige;
        if (!h) return false;

        const audio = {
            rondeId: h.rondeId,
            bron: h.track.bron,
            url: h.track.preview_url,
            startSeconde: startSecondeVoorTrack(h.track),
            durationMs: state.rondeDuurMs,
            herstel: Date.now(),
        };

        if (state.fase === 'raden') {
            const gepauzeerd = !!h.gepauzeerd;
            socket.emit('ronde:start', {
                rondeId: h.rondeId,
                rondenummer: state.rondenummer,
                totaal: state.totaalRondes,
                durationMs: state.modus === 'kenner'
                    ? null
                    : gepauzeerd
                      ? h.restMs
                      : state.rondeDuurMs,
                startTs: gepauzeerd ? Date.now() : h.startTijd,
                modus: state.modus,
                antwoordModus: state.antwoordModus,
                opties: h.antwoordOpties?.opties || null,
                herstel: true,
            });
            if (socket.data.isHost) {
                socket.emit('ronde:audio', { ...audio, pauze: gepauzeerd });
            }
            if (gepauzeerd) socket.emit('ronde:pauze', { gepauzeerd: true });
            return true;
        }

        if (['onthul', 'bonus', 'scorebord'].includes(state.fase)) {
            socket.emit('ronde:onthul', { antwoord: this.antwoordInfo(h) });
        }

        if (state.fase === 'bonus' && h.bonus?.vraag) {
            socket.emit('ronde:bonus', {
                vraag: h.bonus.vraag,
                opties: h.bonus.opties,
                uitgeslotenIndexen: [...(h.bonus.uitgeslotenVoorIedereen || new Set())],
                durationMs: null,
                startTs: h.bonus.startTijd,
                herstel: true,
            });
            return true;
        }

        if (state.fase === 'scorebord') {
            socket.emit('ronde:afgelopen', {
                scorebord: await this.haalScorebord(state),
            });
            // Een overgang die tijdens de eerste poging faalde laat het
            // scorebord zonder timer achter. Herstel plant dan opnieuw één
            // serverovergang; meerdere clients kunnen geen dubbele timer
            // veroorzaken.
            if (!state.scorebordTimer && !state.volgendeBezig) {
                this.planVolgendeRonde(state);
            }
            return true;
        }

        return true;
    }

    rapporteerOvergangsfout(state, err, context) {
        logger.fout('Automatische spelovergang mislukt.', {
            code: state.code,
            context,
            melding: err.message,
        });
        this.io.to(kamer(state.code)).emit('spel:fout', {
            melding: 'De ronde kon niet automatisch doorgaan. De host kan opnieuw proberen.',
        });
        this.io.to(kamer(state.code)).emit('spel:herstel-nodig', {
            fase: state.fase,
        });
    }

    planVolgendeRonde(state) {
        if (state.scorebordTimer) clearTimeout(state.scorebordTimer);
        const versie = ++state.overgangVersie;
        state.scorebordTimer = setTimeout(() => {
            state.scorebordTimer = null;
            if (
                this.spellen.get(state.lobbyId) !== state ||
                state.fase !== 'scorebord' ||
                state.overgangVersie !== versie
            ) {
                return;
            }
            this.volgendeRonde(state).catch((err) =>
                this.rapporteerOvergangsfout(state, err, 'scorebord timer'),
            );
        }, SCOREBORD_PAUZE_MS);
    }

    // ---- Spel starten ----
    async startSpel({ lobbyId, code, instellingen }) {
        if (this.spellen.has(lobbyId)) {
            this.io.to(kamer(code)).emit('spel:voorbereiden', {
                melding: 'Dit spel wordt al voorbereid. Even geduld…',
                bezig: true,
            });
            return;
        }

        // De jongste deelnemer bepaalt automatisch de veilige bovengrens.
        // De host kan daarnaast in Setup een strengere grens kiezen.
        const { rows: spelers } = await pool.query(
            `SELECT id, leeftijd, verbonden FROM spelers WHERE lobby_id = $1`,
            [lobbyId],
        );
        const leeftijden = spelers
            .map((s) => Number(s.leeftijd))
            .filter((leeftijd) => Number.isInteger(leeftijd) && leeftijd > 0);
        const gekozenLeeftijd = Number(instellingen?.leeftijd_max) || 0;
        const opgegevenJongste = Number(instellingen?.leeftijd_deelnemer_min);
        const jongste = leeftijden.length
            ? Math.min(...leeftijden)
            : (Number.isInteger(opgegevenJongste) && opgegevenJongste > 4 ? opgegevenJongste : 0);
        const leeftijdMax = gekozenLeeftijd > 0 && jongste > 0
            ? Math.min(gekozenLeeftijd, jongste)
            : gekozenLeeftijd || jongste;
        const spelInstellingen = {
            ...(instellingen || {}),
            leeftijd_max: leeftijdMax,
            kindvriendelijk: kindmodusUit(instellingen),
            alleen_lokaal: true,
        };

        const { where, params } = bouwFilter(spelInstellingen);
        const { rows: titels } = await pool.query(
            `SELECT t.id, t.naam, t.aliassen, t.type, t.taal, t.jaar,
                    t.land, t.genres, t.tmdb_id, t.poster_pad, t.omschrijving,
                    t.hoofdrollen, t.speelplek, t.studio, t.leeftijdsgrens,
                    t.toevoeg_reden, t.nl_tv_bekend, t.curatie_status
               FROM titels t
               ${where}`,
            params,
        );

        if (titels.length === 0) {
            this.io.to(kamer(code)).emit('spel:fout', {
                melding: 'Geen speelbare titels met deze filters.',
            });
            return;
        }

        const gevraagd = Number(spelInstellingen?.rondes) || 0; // 0 = eindeloos
        const pool_ = husselArray(titels);
        const totaal = gevraagd > 0 ? Math.min(gevraagd, pool_.length) : pool_.length;

        const aantalHulplijnen = lifelineAantal(spelInstellingen);
        const voorraad = new Map();
        const verwijder3Voorraad = new Map();
        for (const s of spelers) {
            voorraad.set(s.id, aantalHulplijnen);
            verwijder3Voorraad.set(s.id, aantalHulplijnen);
        }

        const state = {
            lobbyId,
            code,
            instellingen: spelInstellingen,
            rondeDuurMs: rondeDuurUit(spelInstellingen),
            modus: modusUit(spelInstellingen),
            antwoordModus: antwoordModusUit(spelInstellingen),
            pool: pool_,
            totaalRondes: totaal,
            rondenummer: 0,
            voorraad,
            verwijder3Voorraad,
            voorbereideTracks: new Map(),
            gebruikteTrackIds: new Set(),
            leeftijden: new Map(spelers.map((s) => [s.id, Number(s.leeftijd)])),
            solo: spelers.filter((speler) => speler.verbonden !== false).length === 1,
            // Vraag-id's die in dit spel al gebruikt zijn, zodat dezelfde
            // titel niet twee keer dezelfde bonusvraag geeft.
            gebruikteVragen: new Set(),
            fase: 'wachten',
            huidige: null,
            volgendeBezig: false,
            scorebordTimer: null,
            overgangVersie: 0,
        };
        this.spellen.set(lobbyId, state);

        try {
            // Rondes van een vorig spel in deze lobby opruimen. De tabel heeft
            // UNIQUE (lobby_id, rondenummer), dus zonder dit botst een tweede
            // spel meteen op ronde 1 en start het helemaal niet meer.
            // Antwoorden hangen aan de ronde en verdwijnen mee.
            await pool.query(`DELETE FROM rondes WHERE lobby_id = $1`, [lobbyId]);

            await pool.query(
                `UPDATE lobbies SET status = 'bezig', huidige_ronde = 0 WHERE id = $1`,
                [lobbyId],
            );
            logger.info('Spel gestart.', { code, totaal });

            this.io.to(kamer(code)).emit('spel:voorbereiden', {
                melding: 'Lokale tracks klaarzetten…',
                verwerkt: 0,
                totaal,
            });
            const voorbereiding = await this.bereidTracksVoor(state);
            if (!voorbereiding.geslaagd) {
                this.spellen.delete(lobbyId);
                await pool.query(
                    `UPDATE lobbies SET status = 'wachten', huidige_ronde = 0 WHERE id = $1`,
                    [lobbyId],
                );
                const eersteFout = voorbereiding.mislukt[0];
                this.io.to(kamer(code)).emit('spel:fout', {
                    melding: `Spel niet gestart: er zijn maar ${voorbereiding.gevonden} volledig lokale audiobestanden beschikbaar voor deze filters${gevraagd > 0 ? `, terwijl er ${voorbereiding.gevraagd} rondes gevraagd zijn` : ''}. ${eersteFout ? `${eersteFout.titel}: ${eersteFout.melding}` : 'Controleer de downloads in het adminportaal.'}`,
                });
                logger.waarschuwing('Spelstart afgebroken omdat niet alle audio lokaal beschikbaar is.', {
                    code,
                    totaal: voorbereiding.totaal,
                    mislukt: voorbereiding.mislukt.length,
                });
                return;
            }
            await this.volgendeRonde(state);
        } catch (err) {
            this.spellen.delete(lobbyId);
            await pool.query(
                `UPDATE lobbies SET status = 'wachten', huidige_ronde = 0 WHERE id = $1`,
                [lobbyId],
            ).catch(() => {});
            this.io.to(kamer(code)).emit('spel:fout', {
                melding: `Spel starten mislukt: ${err.message || 'onbekende fout'}`,
            });
            throw err;
        }
    }

    async bereidTracksVoor(state) {
        const gevraagd = state.totaalRondes;
        const kandidaten = state.pool.slice();
        const geplandeTitels = [];
        const mislukt = [];
        let verwerkt = 0;
        for (const titel of kandidaten) {
            if (geplandeTitels.length >= gevraagd) break;
            const track = await this.kiesTrackVoorTitel(titel, state.gebruikteTrackIds, state.instellingen);
            if (!track) {
                mislukt.push({ titel: titel.naam, melding: 'Geen lokale track met status available.' });
                await this.registreerOntbrekendeTitel(titel.id);
                verwerkt += 1;
                this.io.to(kamer(state.code)).emit('spel:voorbereiden', {
                    melding: `Lokale tracks klaarzetten… ${Math.min(geplandeTitels.length, gevraagd)}/${gevraagd}`,
                    verwerkt,
                    totaal: gevraagd,
                    huidige: titel.naam,
                });
                continue;
            }
            // De database-status is leidend. De admin/media-healthtaak zet
            // download_status op available zodra de lokale kopie klaar is.
            // Spelstart leest hier alleen de database en controleert nooit
            // opnieuw bestand, YouTube of TMDB.
            state.voorbereideTracks.set(titel.id, track);
            geplandeTitels.push(titel);
            verwerkt += 1;
            this.io.to(kamer(state.code)).emit('spel:voorbereiden', {
                melding: `Lokale tracks klaarzetten… ${Math.min(geplandeTitels.length, gevraagd)}/${gevraagd}`,
                verwerkt,
                totaal: gevraagd,
                huidige: titel.naam,
            });
        }
        state.pool = geplandeTitels;
        state.totaalRondes = geplandeTitels.length;
        return {
            gevraagd,
            gevonden: geplandeTitels.length,
            totaal: kandidaten.length,
            mislukt,
            geslaagd: geplandeTitels.length === gevraagd,
        };
    }

    async kiesTrackVoorTitel(titel, uitgesloten = new Set(), instellingen = {}) {
        const { rows } = await pool.query(
            `SELECT tr.id, tr.bron, tr.preview_url, tr.bestand_pad, tr.start_seconde,
                    tr.tracknaam, tr.artiest, tr.album,
                    tr.verificatie_score, tr.verificatie_reden, tr.download_status,
                    tr.bron_url, tr.audio_sha256, tr.itunes_track_id
               FROM tracks tr
              WHERE tr.titel_id = $1
                AND tr.werkt = true
                AND tr.bron = 'lokaal'
                AND tr.itunes_track_id IS NULL
                AND tr.download_status = 'available'
                AND tr.preview_url IS NOT NULL
                AND tr.preview_url <> ''
                AND ($2::boolean = false
                     OR (tr.gecontroleerd = true AND tr.verificatie_score >= 0.85))
              ORDER BY CASE
                           -- Alleen lokale bestanden mogen het spel in.
                           WHEN tr.bron = 'lokaal' THEN 5
                           ELSE 1
                       END DESC,
                       tr.keer_gespeeld ASC,
                       tr.laatst_gespeeld ASC NULLS FIRST,
                       tr.verificatie_score DESC,
                       tr.herkenbaarheid DESC,
                       random(),
                       tr.id DESC
              LIMIT 20`,
            [titel.id, instellingen?.alleen_gecontroleerd === true],
        );

        let eersteGeldige = null;
        for (const kandidaat of rows) {
            // Een speltrack is door de admin/import al opgeslagen en lokaal
            // beschikbaar verklaard. Vertrouw die databasekeuze; voer tijdens
            // spelstart geen extra titel-, bestand-, YouTube- of TMDB-check uit.
            if (!eersteGeldige) eersteGeldige = kandidaat;
            if (!uitgesloten.has(kandidaat.id)) return kandidaat;
        }
        // Als één titel werkelijk maar één goedgekeurde track heeft, is
        // herhalen beter dan de ronde zonder muziek starten.
        return eersteGeldige;
    }

    async registreerOntbrekendeTitel(titelId) {
        try {
            await pool.query(
                `INSERT INTO meldingen (titel_id, soort, toelichting)
                 SELECT $1, 'geen_track',
                        'Alle gekoppelde tracks zijn tijdens controle afgekeurd; voeg audio toe via het adminportaal.'
                  WHERE NOT EXISTS (
                      SELECT 1 FROM meldingen
                       WHERE titel_id = $1 AND soort = 'geen_track' AND afgehandeld = false
                  )`,
                [titelId],
            );
        } catch (err) {
            logger.waarschuwing('Ontbrekende track kon niet worden gemeld.', {
                titelId,
                melding: err.message,
            });
        }
    }

    /**
     * Haal een diverse steekproef afleider-kandidaten voor de meerkeuzevraag.
     *
     * Belangrijk: de afleiders moeten dezelfde inhoudsfilters respecteren als
     * de speelbare titels. Anders zou een kindvriendelijk spel (of een spel met
     * een leeftijdsgrens of uitgesloten genres) een titel voor volwassenen of
     * een niet-gecureerde titel (`curatie_status <> 'goedgekeurd'`) als
     * antwoordoptie kunnen tonen. Daarom hergebruikt deze query `bouwFilter`
     * met exact de spelinstellingen — alleen zonder `alleen_lokaal`, want een
     * afleider hoeft geen speelbare lokale track te hebben.
     *
     * Bij voorkeur dezelfde taal als het juiste antwoord; levert dat te weinig,
     * dan wordt aangevuld met de andere talen binnen dezelfde filters. Zo
     * wisselen de afleiders per ronde en blijven ze inhoudelijk veilig. Bij een
     * mislukte query valt de aanroeper terug op de spel-pool.
     */
    async haalAfleiderPool(state, titel) {
        try {
            const filter = bouwFilter({ ...state.instellingen, alleen_lokaal: false });
            const idIdx = filter.params.length + 1;
            const basis = `SELECT t.id, t.naam, t.type, t.taal, t.jaar, t.genres
                             FROM titels t
                            ${filter.where} AND t.id <> $${idIdx}`;

            const taalIdx = filter.params.length + 2;
            const { rows } = await pool.query(
                `${basis}
                    AND ($${taalIdx}::titel_taal IS NULL OR t.taal = $${taalIdx})
                  ORDER BY random() LIMIT 150`,
                [...filter.params, titel.id, titel.taal || null],
            );
            // Genoeg titels in de eigen taal? Klaar. Anders aanvullen met de
            // andere talen binnen dezelfde filters, zodat er altijd zes
            // opties zijn.
            if (rows.length >= 5 * (AANTAL_MEERKEUZE_OPTIES - 1)) return rows;
            const breed = await pool.query(
                `${basis} ORDER BY random() LIMIT 150`,
                [...filter.params, titel.id],
            );
            const gezien = new Set(rows.map((r) => r.id));
            for (const r of breed.rows) {
                if (!gezien.has(r.id)) rows.push(r);
            }
            return rows;
        } catch (err) {
            logger.waarschuwing('Afleiderpool ophalen mislukt.', {
                titel: titel.naam,
                melding: err.message,
            });
            return [];
        }
    }

    // ---- Volgende ronde ----
    async volgendeRonde(state) {
        if (
            !state ||
            this.spellen.get(state.lobbyId) !== state ||
            state.fase === 'einde' ||
            state.volgendeBezig
        ) {
            return;
        }

        state.volgendeBezig = true;
        if (state.scorebordTimer) {
            clearTimeout(state.scorebordTimer);
            state.scorebordTimer = null;
        }
        state.overgangVersie += 1;
        const vorigeRonde = state.rondenummer;
        const vorigeHuidige = state.huidige;
        const vorigeFase = state.fase;

        try {
            // Een titel zonder bruikbare track telt niet als ronde. Blijf in
            // dezelfde overgang zoeken, zodat meerdere onbruikbare titels
            // geen concurrerende recursieve overgang kunnen starten.
            while (true) {
                state.rondenummer += 1;
                if (state.rondenummer > state.totaalRondes) {
                    return await this.eindigSpel(state);
                }

                // Hintvoorraad aanvullen: +1 per 10 gespeelde vragen.
                if (state.rondenummer > 1 && (state.rondenummer - 1) % 10 === 0) {
                    for (const id of state.voorraad.keys()) {
                        state.voorraad.set(id, state.voorraad.get(id) + 1);
                    }
                }

                const titel = state.pool[state.rondenummer - 1];
                let track = state.voorbereideTracks.get(titel.id);
                if (track && state.gebruikteTrackIds.has(track.id)) track = null;
                track = track || await this.kiesTrackVoorTitel(
                    titel,
                    state.gebruikteTrackIds,
                    state.instellingen,
                );

                if (!track) {
                    throw new Error(`Lokale track ontbreekt voor "${titel.naam}". Herstel de download via het adminportaal.`);
                }

                state.gebruikteTrackIds.add(track.id);

                const rondeRij = await pool.query(
                    `INSERT INTO rondes
                       (lobby_id, rondenummer, titel_id, track_id, start_ms, duur_ms, status)
                     VALUES ($1, $2, $3, $4, 0, $5, 'raden')
                     RETURNING id`,
                    [state.lobbyId, state.rondenummer, titel.id, track.id, state.rondeDuurMs],
                );

                // Afleiders uit de héle titeldatabase (zelfde taal + genre,
                // jaar in de buurt), zodat ze per ronde variëren in plaats van
                // steeds dezelfde paar titels uit de quiz-pool. Terugval op de
                // spel-pool als de database niets bruikbaars geeft.
                let antwoordOpties = null;
                if (state.antwoordModus === 'meerkeuze') {
                    const afleiderPool = await this.haalAfleiderPool(state, titel);
                    const bron = afleiderPool.length >= AANTAL_MEERKEUZE_OPTIES - 1
                        ? afleiderPool
                        : state.pool;
                    antwoordOpties = bouwMeerkeuzeOpties(titel, bron)
                        || bouwMeerkeuzeOpties(titel, state.pool);
                }

                const nieuweHuidige = {
                    rondeId: rondeRij.rows[0].id,
                    titel,
                    track,
                    startTijd: Date.now(),
                    klaar: new Set(), // spelers die goed hebben
                    hints: new Map(), // spelerId -> aantal hints deze ronde
                    antwoorden: new Map(), // spelerId -> {punten, verstreken}
                    ingediend: new Set(), // geen pogingen meer toegestaan
                    gokPogingen: new Map(), // solo mag twee titelgokken doen
                    laatsteGok: new Map(), // spelerId -> timestamp (rate limit)
                    antwoordOpties,
                    verwijderdeOpties: new Map(), // spelerId -> indexen
                    timer: null,
                };

                await pool.query(`UPDATE lobbies SET huidige_ronde = $1 WHERE id = $2`, [
                    state.rondenummer,
                    state.lobbyId,
                ]);

                // Zet de nieuwe state pas vast nadat de overgangsquery's zijn
                // gelukt. Zo kan een retry vanaf het scorebord niet per
                // ongeluk een rondenummer overslaan.
                state.huidige = nieuweHuidige;
                state.fase = 'raden';

                // Spelers: geen titel, geen audio-URL. In kennersmodus telt
                // er niets af — de host bepaalt wanneer de ronde voorbij is.
                this.io.to(kamer(state.code)).emit('ronde:start', {
                    rondeId: state.huidige.rondeId,
                    rondenummer: state.rondenummer,
                    totaal: state.totaalRondes,
                    durationMs: state.modus === 'kenner' ? null : state.rondeDuurMs,
                    startTs: state.huidige.startTijd,
                    modus: state.modus,
                    antwoordModus: state.antwoordModus,
                    opties: state.huidige.antwoordOpties?.opties || null,
                });
                // Host: krijgt de audio om af te spelen in de kamer.
                this.io.to(hostKamer(state.code)).emit('ronde:audio', {
                    rondeId: state.huidige.rondeId,
                    bron: track.bron,
                    url: track.preview_url,
                    startSeconde: startSecondeVoorTrack(track),
                    durationMs: state.rondeDuurMs,
                });

                // Bijhouden hoe vaak en wanneer deze track gespeeld is.
                await pool.query(
                    `UPDATE tracks SET keer_gespeeld = keer_gespeeld + 1,
                            laatst_gespeeld = now() WHERE id = $1`,
                    [track.id],
                ).catch((err) => logger.waarschuwing('Trackgebruik kon niet worden opgeslagen.', {
                    trackId: track.id,
                    melding: err.message,
                }));

                // In kennersmodus loopt er geen klok: de host klikt op
                // 'Volgende'.
                if (state.modus !== 'kenner') {
                    state.huidige.timer = setTimeout(() => {
                        this.onthulEnBonus(state).catch((err) =>
                            this.rapporteerOvergangsfout(state, err, 'ronde timer'),
                        );
                    }, state.rondeDuurMs);
                }
                return;
            }
        } catch (err) {
            // Fouten vóór het vastzetten van de nieuwe ronde mogen geen
            // sprong van bijvoorbeeld ronde 4 naar 6 veroorzaken. Fouten ná
            // het publiceren van 'raden' laten de actuele ronde intact.
            if (state.fase === vorigeFase) {
                state.rondenummer = vorigeRonde;
                state.huidige = vorigeHuidige;
            }
            throw err;
        } finally {
            state.volgendeBezig = false;
        }
    }

    // ---- Gok verwerken ----
    async verwerkGok(socket, gok) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'raden' || !state.huidige) return;
        const spelerId = socket.data.spelerId;
        if (!spelerId) return;

        const h = state.huidige;
        if (h.klaar.has(spelerId) || h.ingediend.has(spelerId)) return;

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
        const poging = (h.gokPogingen.get(spelerId) || 0) + 1;
        const maximaal = maxTitelPogingen(state);
        h.gokPogingen.set(spelerId, poging);
        // Meerdere snelle taps kunnen niet meer pogingen veroorzaken: het
        // aantal wordt vóór de vergelijking server-side vastgelegd.
        if (poging >= maximaal) h.ingediend.add(spelerId);

        const uitslag = vergelijk(gok, h.titel);

        if (uitslag.status === 'goed') {
            const verstreken = nu - h.startTijd;
            const hintsGebruikt = h.hints.get(spelerId) || 0;
            const basisPunten = titelPunten(verstreken, hintsGebruikt, state.instellingen);
            const factor = leeftijdsFactor(state.leeftijden.get(spelerId), state.instellingen);
            const gokFactor = poging >= 2 ? 0.5 : 1;
            const punten = Math.round(basisPunten * factor * gokFactor);
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
                keuze: gok,
                poging,
                maxPogingen: maximaal,
                tweedeGok: poging >= 2,
                ingediend: true,
            });
            await this.stuurScores(state);

            // Snelste-modus: de eerste met het juiste antwoord wint de ronde.
            // Kennersmodus: iedereen mag doorgaan tot de host verder klikt.
            if (state.modus === 'snelste') {
                this.io.to(kamer(state.code)).emit('ronde:gewonnen', {
                    spelerId,
                });
                this.onthulEnBonus(state).catch((err) =>
                    this.rapporteerOvergangsfout(state, err, 'juiste gok'),
                );
            } else if (await this.iedereenKlaar(state)) {
                // Iedereen heeft het goed: dan hoeft de host niet te wachten.
                this.onthulEnBonus(state).catch((err) =>
                    this.rapporteerOvergangsfout(state, err, 'iedereen klaar'),
                );
            }
        } else if (uitslag.status === 'bijna') {
            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'bijna',
                melding: poging < maximaal ? 'Bijna! Je mag nog één keer gokken.' : 'Bijna — je laatste gok is ingestuurd.',
                poging,
                maxPogingen: maximaal,
                opnieuw: poging < maximaal,
                ingediend: poging >= maximaal,
            });
        } else {
            this.io.to(spelerKamer(spelerId)).emit('ronde:resultaat', {
                status: 'fout',
                melding: poging < maximaal ? 'Fout. Je mag nog één keer gokken.' : 'Fout. Je laatste gok is ingestuurd.',
                poging,
                maxPogingen: maximaal,
                opnieuw: poging < maximaal,
                ingediend: poging >= maximaal,
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

        await this.verrijkHintMetadata(h.titel);
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

    verwijderDrieFouteOpties(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'raden' || !state.huidige?.antwoordOpties) return;
        const spelerId = socket.data.spelerId;
        if (!spelerId || state.huidige.klaar.has(spelerId)) return;

        const voorraad = state.verwijder3Voorraad.get(spelerId) || 0;
        if (voorraad <= 0) {
            this.io.to(spelerKamer(spelerId)).emit('ronde:verwijder3', {
                fout: 'Deze hulplijn is op.',
            });
            return;
        }
        if (state.huidige.verwijderdeOpties.has(spelerId)) {
            this.io.to(spelerKamer(spelerId)).emit('ronde:verwijder3', {
                fout: 'Je hebt deze hulplijn deze ronde al gebruikt.',
            });
            return;
        }

        const correct = state.huidige.antwoordOpties.correctIndex;
        const fout = state.huidige.antwoordOpties.opties
            .map((_optie, index) => index)
            .filter((index) => index !== correct);
        const indexen = husselArray(fout).slice(0, 3);
        state.huidige.verwijderdeOpties.set(spelerId, indexen);
        state.verwijder3Voorraad.set(spelerId, voorraad - 1);
        this.io.to(spelerKamer(spelerId)).emit('ronde:verwijder3', {
            indexen,
            voorraad: voorraad - 1,
        });
    }

    async verrijkHintMetadata(titel) {
        if (!tmdb.beschikbaar() || !titel?.tmdb_id || titel.hoofdrollen?.length) return;
        try {
            const details = await tmdb.haalDetails(titel.tmdb_id, titel.type);
            const hoofdrollen = (details.cast || []).slice(0, 5);
            if (!hoofdrollen.length) return;
            titel.hoofdrollen = hoofdrollen;
            await pool.query(
                `UPDATE titels SET hoofdrollen = $2::text[] WHERE id = $1`,
                [titel.id, hoofdrollen],
            );
        } catch (err) {
            logger.waarschuwing('Hoofdrollen voor hint konden niet worden opgehaald.', {
                titel: titel.naam,
                melding: err.message,
            });
        }
    }

    bouwHint(nr, titel) {
        const hints = bouwHinten(titel);
        return hints[Math.min(Math.max(nr - 1, 0), hints.length - 1)] || {
            type: 'geen',
            tekst: 'Er is geen extra hint beschikbaar.',
        };
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
                (vraag) => bonusVraagPastPeriode(vraag, h.titel, state.instellingen),
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
            const bonus = await genereerBonus(h.titel, {
                jaarMin: Number(state.instellingen?.periode_start),
                jaarMax: Number(state.instellingen?.periode_eind),
            });
            if (!bonus) {
                return this.naarScorebord(state);
            }
            if (bonus.type === 'jaar') {
                const liveJaar = Number(bonus.opties.find((optie) => optie.correct)?.tekst);
                if (liveJaar !== Number(h.titel.jaar)) return this.naarScorebord(state);
            }
            vraagTekst = bonus.vraag;
            opties = bonus.opties.map((o) => o.tekst);
            correctIndex = bonus.opties.findIndex((o) => o.correct);
            soort = bonus.type;
        }

        h.bonus = {
            correctIndex,
            vraag: vraagTekst,
            opties,
            pogingen: new Map(), // spelerId -> aantal pogingen
            uitgeslotenOpties: new Map(), // spelerId -> Set met foute indexen
            uitgeslotenVoorIedereen: new Set(), // één foute keuze verdwijnt voor alle spelers
            opnieuwVanaf: new Map(), // spelerId -> timestamp na een fout
            klaar: new Set(), // spelers die klaar zijn (goed of op)
            afgesloten: false,
            eindeTimer: null,
            type: soort,
            startTijd: Date.now(),
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
            uitgeslotenIndexen: [],
            durationMs: null,
            startTs: h.bonus.startTijd,
        });
    }

    // ---- Bonusantwoord verwerken ----
    async verwerkBonus(socket, keuze) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'bonus' || !state.huidige?.bonus) return;
        const spelerId = socket.data.spelerId;
        const b = state.huidige.bonus;
        if (b.afgesloten || b.klaar.has(spelerId)) return;

        const nu = Date.now();
        const opnieuwVanaf = b.opnieuwVanaf.get(spelerId) || 0;
        if (nu < opnieuwVanaf) {
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'wachten',
                resterendMs: opnieuwVanaf - nu,
            });
            return;
        }

        const index = Number(keuze);
        if (!Number.isInteger(index) || index < 0 || index >= b.opties.length) return;
        const globaleUitsluitingen = b.uitgeslotenVoorIedereen || new Set();
        if (globaleUitsluitingen.has(index)) {
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'optie-weg',
                uitgeslotenIndex: index,
                uitgeslotenIndexen: [...globaleUitsluitingen],
            });
            return;
        }
        const uitgesloten = b.uitgeslotenOpties.get(spelerId) || new Set();
        if (uitgesloten.has(index)) return;

        const poging = (b.pogingen.get(spelerId) || 0) + 1;
        b.pogingen.set(spelerId, poging);

        const goed = index === b.correctIndex;
        if (goed) {
            const verstreken = nu - b.startTijd;
            const basisPunten = bonusPunten(poging, verstreken);
            const factor = leeftijdsFactor(state.leeftijden.get(spelerId), state.instellingen);
            const punten = Math.round(basisPunten * factor);
            b.klaar.add(spelerId);
            await this.telScoreOp(spelerId, punten);
            await this.werkBonusAntwoordBij(state, spelerId, {
                bonus_goed: true,
                bonus_pogingen: poging,
                bonus_punten: punten,
            });
            b.afgesloten = true;
            // Iedereen ziet welk vlak juist was; de winnaar krijgt in het
            // persoonlijke bericht ook de punten. Het korte uitstel maakt
            // de groene feedback zichtbaar vóór het scorebord verschijnt.
            this.io.to(kamer(state.code)).emit('ronde:bonus-resultaat', {
                status: 'goed',
                keuze: index,
                correctIndex: b.correctIndex,
                spelerId,
            });
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'goed',
                punten,
                keuze: index,
                correctIndex: b.correctIndex,
            });
            await this.stuurScores(state);
            b.eindeTimer = setTimeout(() => {
                this.eindBonus(state).catch((err) =>
                    this.rapporteerOvergangsfout(state, err, 'bonus goed antwoord'),
                );
            }, 1200);
            return;
        } else {
            // Een foute optie verdwijnt bij iedereen. Alleen de speler die
            // hem koos krijgt vijf seconden cooldown en mag daarna opnieuw.
            uitgesloten.add(index);
            b.uitgeslotenOpties.set(spelerId, uitgesloten);
            globaleUitsluitingen.add(index);
            b.uitgeslotenVoorIedereen = globaleUitsluitingen;
            b.opnieuwVanaf.set(spelerId, nu + BONUS_COOLDOWN_MS);
            this.io.to(kamer(state.code)).emit('ronde:bonus-resultaat', {
                status: 'optie-weg',
                uitgeslotenIndex: index,
                uitgeslotenIndexen: [...globaleUitsluitingen],
                spelerId,
            });
            this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
                status: 'fout',
                keuze: index,
                uitgeslotenIndexen: [...globaleUitsluitingen],
                cooldownMs: BONUS_COOLDOWN_MS,
            });
        }

        if (await this.iedereenBonusKlaar(state)) {
            this.eindBonus(state).catch((err) =>
                this.rapporteerOvergangsfout(state, err, 'iedereen bonus klaar'),
            );
        }
    }

    async eindBonus(state) {
        if (!state || state.fase !== 'bonus') return;
        const b = state.huidige?.bonus;
        if (b?.eindeTimer) {
            clearTimeout(b.eindeTimer);
            b.eindeTimer = null;
        }
        return this.naarScorebord(state);
    }

    /** Een speler mag individueel opgeven; de bonus stopt zodra iedereen klaar is. */
    async geefBonusOp(socket) {
        const state = this.spellen.get(socket.data.lobbyId);
        if (!state || state.fase !== 'bonus' || !state.huidige?.bonus) return;
        const spelerId = socket.data.spelerId;
        const b = state.huidige.bonus;
        if (b.klaar.has(spelerId)) return;
        b.klaar.add(spelerId);
        const poging = b.pogingen.get(spelerId) || 0;
        await this.werkBonusAntwoordBij(state, spelerId, {
            bonus_goed: false,
            bonus_pogingen: poging,
            bonus_punten: 0,
        });
        this.io.to(spelerKamer(spelerId)).emit('ronde:bonus-resultaat', {
            status: 'opgegeven',
        });
        if (await this.iedereenBonusKlaar(state)) {
            await this.eindBonus(state);
        }
    }

    // ---- Scorebord tonen en door naar de volgende ronde ----
    async naarScorebord(state) {
        const h = state.huidige;
        if (!h || state.fase === 'scorebord' || state.fase === 'einde') return;
        if (state.fase !== 'onthul' && state.fase !== 'bonus') return;
        state.fase = 'scorebord';
        await pool.query(`UPDATE rondes SET status = 'afgelopen' WHERE id = $1`, [
            h.rondeId,
        ]);

        const scorebord = await this.haalScorebord(state);
        this.io.to(kamer(state.code)).emit('ronde:afgelopen', { scorebord });
        this.planVolgendeRonde(state);
    }

    // ---- Spel beëindigen ----
    async eindigSpel(state) {
        if (!state || state.fase === 'einde') return;
        if (state.scorebordTimer) clearTimeout(state.scorebordTimer);
        state.scorebordTimer = null;
        state.overgangVersie += 1;
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
        if (state.fase === 'onthul') return this.naarScorebord(state);
        // Het scorebord heeft één eigenaar: de servertimer. Een handmatige
        // klik mag geen tweede overgang naast die timer starten.
        if (state.fase === 'scorebord') return;
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
            h.timer = setTimeout(() => {
                this.onthulEnBonus(state).catch((err) =>
                    this.rapporteerOvergangsfout(state, err, 'hervatte ronde timer'),
                );
            }, h.restMs);
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
            startSeconde: startSecondeVoorTrack(track),
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
            tmdbUrl: h.titel.tmdb_id
                ? `https://www.themoviedb.org/${h.titel.type === 'serie' ? 'tv' : 'movie'}/${h.titel.tmdb_id}`
                : null,
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
            `SELECT id, verbonden FROM spelers
              WHERE lobby_id = $1`,
            [state.lobbyId],
        );
        return iedereenActiefKlaar(rows, state.huidige.bonus.klaar);
    }

    async iedereenKlaar(state) {
        // Iedere verbonden deelnemer telt mee, inclusief de host. De host
        // speelt de muziek op hetzelfde scherm maar kan daar ook antwoorden.
        // Zonder verbonden deelnemers eindigt de ronde via de timer.
        const { rows } = await pool.query(
            `SELECT id, verbonden FROM spelers
              WHERE lobby_id = $1`,
            [state.lobbyId],
        );
        return iedereenActiefKlaar(rows, state.huidige.klaar);
    }

    async haalScorebord(state) {
        const { rows } = await pool.query(
            `SELECT id, naam, score, is_host, team_naam FROM spelers
              WHERE lobby_id = $1 ORDER BY score DESC, naam ASC`,
            [state.lobbyId],
        );
        const teams = new Map();
        for (const speler of rows) {
            if (!speler.team_naam) continue;
            teams.set(speler.team_naam, (teams.get(speler.team_naam) || 0) + Number(speler.score || 0));
        }
        return rows.map((speler) => ({
            ...speler,
            team_score: speler.team_naam ? teams.get(speler.team_naam) : null,
        }));
    }

    async stuurScores(state) {
        const scorebord = await this.haalScorebord(state);
        this.io.to(kamer(state.code)).emit('spel:scores', scorebord);
    }
}

module.exports = {
    SpelBeheer,
    RONDE_DUUR_MS,
    iedereenActiefKlaar,
    verwijderOnspeelbareTitel,
    beginLetters,
    bouwHinten,
    bouwMeerkeuzeOpties,
    lifelineAantal,
};
