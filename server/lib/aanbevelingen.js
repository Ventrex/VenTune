// =====================================================================
// Aanbevelingen via ChatGPT (Codex) — draagt kandidaten aan die de
// beheerder daarna Tinder-stijl goed/fout/weet-niet swipet.
//
// Twee soorten:
//   'film_serie' — bekende films/series met een algemeen bekend thema/lied
//                  dat er echt bij hoort (bv. The Office-theme, Terminator).
//   'kerst'      — algemeen bekende kerstliedjes (zanger + nummer + jaar).
//
// Harde eis in de prompt: alleen titels met een goede fanbase, geen
// obscure dingen; en alleen nummers die echt bij de titel horen.
// =====================================================================

const codex = require('./codex');
const { pool } = require('../db/pool');
const logger = require('./logger');

// -------------------- JSON-schema's voor Codex --------------------

const SCHEMA_FILM_SERIE = {
    type: 'object',
    additionalProperties: false,
    required: ['kandidaten'],
    properties: {
        kandidaten: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['titel', 'type', 'jaar', 'genres', 'tracknaam', 'artiest',
                           'themas', 'studio', 'muziek_genres', 'muziek_type', 'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    titel: { type: 'string' },
                    type: { type: 'string', enum: ['film', 'serie'] },
                    jaar: { type: 'integer' },
                    genres: { type: 'array', items: { type: 'string' } },
                    themas: { type: 'array', items: { type: 'string' } },
                    studio: { type: ['string', 'null'] },
                    muziek_genres: { type: 'array', items: { type: 'string' } },
                    muziek_type: { type: 'string', enum: ['intro', 'thema', 'soundtrack'] },
                    tracknaam: { type: 'string' },
                    artiest: { type: 'string' },
                    youtube_zoekterm: { type: 'string' },
                    // 1..5: hoe algemeen bekend de titel én het nummer zijn.
                    bekendheid: { type: 'integer', minimum: 1, maximum: 5 },
                    reden: { type: 'string' },
                },
            },
        },
    },
};

const SCHEMA_KERST = {
    type: 'object',
    additionalProperties: false,
    required: ['kandidaten'],
    properties: {
        kandidaten: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['tracknaam', 'artiest', 'jaar', 'muziek_genres', 'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    tracknaam: { type: 'string' },
                    artiest: { type: 'string' },
                    jaar: { type: 'integer' },
                    muziek_genres: { type: 'array', items: { type: 'string' } },
                    youtube_zoekterm: { type: 'string' },
                    bekendheid: { type: 'integer', minimum: 1, maximum: 5 },
                    reden: { type: 'string' },
                },
            },
        },
    },
};

// -------------------------- prompts --------------------------

function promptFilmSerie({ aantal, taal, bestaand }) {
    const taalregel = taal === 'nl'
        ? 'Kies vooral Nederlandse films en series (bv. Zwartboek, Flodder, Undercover, Gooische Vrouwen) en internationaal zeer bekende titels die Nederlanders kennen.'
        : taal === 'en'
            ? 'Kies internationaal zeer bekende Engelstalige films en series.'
            : 'Kies een mix van bekende Nederlandse titels en internationaal zeer bekende titels die Nederlanders kennen.';
    const uitsluiten = (bestaand && bestaand.length)
        ? `\n\nDeze titels zitten al in de database, sla ze over:\n- ${bestaand.slice(0, 200).join('\n- ')}`
        : '';
    return `Je helpt een muziekquiz over films en series (zoals Hitster) vullen.

Geef ${aantal} verschillende kandidaten (nooit een lege lijst): elk een bekende film of serie met de ORIGINELE SOUNDTRACK — de officiële theme song, titelmuziek of het iconische herkenningsnummer dat echt bij die film/serie hoort. Denk aan: de titelmuziek van The Office, het thema van CSI (Who Are You - The Who), de titelsong van Friends (I'll Be There For You), het thema van Terminator.

Harde eisen:
- Alleen films/series met een GOEDE FANBASE. Geen obscure of nauwelijks bekende titels.
- Geef uitsluitend titels die NIET in de uitsluitlijst staan. Gebruik alternatieven als een titel al bestaat.
- Een herkenbare intro, officiële titelmuziek of iconische soundtrack is toegestaan; geef geen niet-gerelateerde nummers.
- Gebruik jouw kennis om een lijst samen te stellen. Zoek zo nodig online ter verificatie, maar geef ook zonder gevonden webresultaten de beste feitelijke kandidaten terug.
- Het nummer moet de ECHTE, originele soundtrack/titelmuziek zijn — niet een willekeurig liedje of een cover.
- Geef, als het een bestaand lied is, de echte artiest; is het instrumentale titelmuziek, geef dan de componist of "Titelmuziek".
- Vul 'bekendheid' 1..5: 5 = vrijwel iedereen herkent het meteen, 1 = alleen fans. Geef niets onder de 3.
- 'youtube_zoekterm': waarmee je de originele soundtrack op YouTube vindt (bv. "The Office theme song", "CSI Who Are You theme").
- Geef genres van de film/serie (bv. Actie, Komedie), themas (bv. Superhelden, Kerst, Disney), studio/uitgever (bv. Disney, Warner Bros., Netflix) of null indien onbekend.
- Geef de muziek_genres van het daadwerkelijke nummer (bv. Rock, Pop, Orkestraal) en muziek_type: intro, thema of soundtrack.
- 'reden': één korte zin waarom dit het herkenningsnummer van die titel is.
${taalregel}${uitsluiten}`;
}

function promptKerst({ aantal, bestaand }) {
    const uitsluiten = (bestaand && bestaand.length)
        ? `\n\nDeze nummers zitten al in de database, sla ze over:\n- ${bestaand.slice(0, 200).join('\n- ')}`
        : '';
    return `Je helpt een kerstmuziek-quiz vullen. In het spel moeten spelers de zanger, het nummer en het jaartal raden.

Geef ${aantal} VERSCHILLENDE kandidaten voor een top 100 van algemeen bekende kerstliedjes die vrijwel iedereen kent (bv. de grote kersthits die elk jaar overal klinken).

Harde eisen:
- Alleen ECHT BEKENDE kerstliedjes met een brede fanbase. Geen obscure nummers.
- Sla alle nummers uit de uitsluitlijst over, kies andere bekende nummers.
- Gebruik jouw kennis om de top samen te stellen en verifieer jaartallen zo nodig via web search; geef nooit een lege lijst puur omdat online zoeken niets opleverde.
- Het jaar is het oorspronkelijke uitgavejaar van de genoemde uitvoering (niet het jaar waarin de compositie is geschreven).
- Geef het jaar van de originele/bekendste uitgave zo nauwkeurig mogelijk.
- Vul 'bekendheid' 1..5: 5 = iedereen kent het, 1 = alleen liefhebbers. Geef niets onder de 3.
- 'youtube_zoekterm': waarmee je het nummer op YouTube vindt (bv. "Wham Last Christmas").
- Vermeld muziek_genres (bv. Pop, Rock, Jazz of Klassiek) voor toekomstige genreselecties.
- 'reden': één korte zin.
- Mix Engelstalige en Nederlandstalige kersthits.${uitsluiten}`;
}

// ----------------------- hoofdfunctie -----------------------

/** Bestaande titel-/tracknamen om dubbele aanbevelingen te voorkomen. */
async function bestaandeNamen(soort) {
    if (soort === 'kerst') {
        const { rows } = await pool.query(
            `SELECT DISTINCT lower(tracknaam || ' - ' || artiest) AS n FROM aanbevelingen WHERE soort='kerst'
             UNION SELECT DISTINCT lower(tracknaam || ' - ' || artiest) FROM tracks`);
        return rows.map((r) => r.n).filter(Boolean);
    }
    const { rows } = await pool.query(
        `SELECT DISTINCT lower(titel) AS n FROM aanbevelingen WHERE soort='film_serie'
         UNION SELECT DISTINCT lower(naam) FROM titels`);
    return rows.map((r) => r.n).filter(Boolean);
}

/**
 * Genereer kandidaten via ChatGPT en bewaar ze als 'nieuw' (wachten op swipe).
 * @param {{soort:'film_serie'|'kerst', aantal?:number, taal?:string, minBekendheid?:number, signal?:AbortSignal}} opties
 * @returns {Promise<{ok:boolean, toegevoegd?:number, overgeslagen?:number, error?:string}>}
 */
async function genereer(opties) {
    const soort = opties.soort === 'kerst' ? 'kerst' : 'film_serie';
    const aantal = Math.min(100, Math.max(1, opties.aantal || (100)));
    const minBek = opties.minBekendheid || 3;

    const bestaand = await bestaandeNamen(soort);
    const bestaandeSet = new Set(bestaand.map((n) => String(n).trim().toLowerCase()));

    const schema = soort === 'kerst' ? SCHEMA_KERST : SCHEMA_FILM_SERIE;

    // Grote kerstlijsten in kleine batches opvragen: betrouwbaarder dan 100 items in één AI-antwoord.
    const lijst = [];
    const batchSize = soort === 'kerst' ? 20 : 15;
    const aantalBatches = Math.ceil(aantal / batchSize);
    for (let i = 0; i < aantalBatches; i++) {
        const nodig = Math.min(batchSize, aantal - lijst.length);
        if (nodig <= 0) break;
        const aanvullend = lijst.map((k) => soort === 'kerst' ? `${k.tracknaam} - ${k.artiest}` : k.titel).filter(Boolean);
        const batchPrompt = soort === 'kerst'
            ? promptKerst({ aantal: nodig, bestaand: [...bestaand, ...aanvullend] })
            : promptFilmSerie({ aantal: nodig, taal: opties.taal || 'beide', bestaand: [...bestaand, ...aanvullend] });
        const res = await codex.vraagJson({ prompt: batchPrompt, schema, signal: opties.signal });
        if (!res.ok) {
            if (!lijst.length) return { ok: false, error: res.error };
            logger.waarschuwing('Aanbevelingen batch mislukt', { batch: i + 1, melding: res.error });
            break;
        }
        const ontvangen = Array.isArray(res.data?.kandidaten) ? res.data.kandidaten : [];
        for (const k of ontvangen) {
            if (!k) continue;
            const sleutel = soort === 'kerst' ? `${k.tracknaam || ''} - ${k.artiest || ''}` : k.titel || '';
            const genormaliseerd = sleutel.trim().toLowerCase();
            if (!genormaliseerd || bestaandeSet.has(genormaliseerd)) continue;
            bestaandeSet.add(genormaliseerd);
            lijst.push(k);
        }
        if (!ontvangen.length) {
            logger.waarschuwing('ChatGPT gaf lege aanbevelingenbatch', { soort, batch: i + 1 });
            break;
        }
    }
    if (!lijst.length) {
        return { ok: false, error: 'ChatGPT heeft geen kandidaten teruggegeven. Er is niets toegevoegd.' };
    }
    let toegevoegd = 0;
    let overgeslagen = 0;
    let opslagFouten = 0;
    let eersteOpslagFout = '';

    for (const k of lijst) {
        if (!k || (k.bekendheid || 0) < minBek) { overgeslagen++; continue; }
        try {
            const r = await pool.query(
                `INSERT INTO aanbevelingen
                    (soort, titel, type, jaar, genres, tracknaam, artiest,
                     youtube_zoekterm, bekendheid, reden, themas, studio, muziek_genres, muziek_type, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'nieuw')
                 ON CONFLICT DO NOTHING RETURNING id`,
                [
                    soort,
                    k.titel || null,
                    k.type || null,
                    Number.isFinite(k.jaar) ? k.jaar : null,
                    Array.isArray(k.genres) ? k.genres : [],
                    k.tracknaam || '',
                    k.artiest || '',
                    k.youtube_zoekterm || '',
                    k.bekendheid || minBek,
                    k.reden || null,
                    Array.isArray(k.themas) ? k.themas : [],
                    k.studio || null,
                    Array.isArray(k.muziek_genres) ? k.muziek_genres : [],
                    k.muziek_type || null,
                ],
            );
            if (r.rows[0]) toegevoegd++; else overgeslagen++;
        } catch (err) {
            logger.waarschuwing('Aanbeveling niet opgeslagen', { melding: err.message });
            opslagFouten++;
            if (!eersteOpslagFout) eersteOpslagFout = err.message;
            overgeslagen++;
        }
    }

    logger.info('Aanbevelingen gegenereerd', { soort, ontvangen: lijst.length, toegevoegd, overgeslagen, opslagFouten });
    if (toegevoegd === 0) {
        const reden = opslagFouten
            ? `Opslaan mislukt (${opslagFouten} databasefouten). Eerste fout: ${eersteOpslagFout}`
            : `Geen nieuwe nummers toegevoegd: ${overgeslagen} kandidaat/kandidaten afgekeurd of al aanwezig.`;
        return { ok: false, error: reden };
    }
    return { ok: true, toegevoegd, overgeslagen };
}

const SCHEMA_CORRECTIE = {
    type: 'object', additionalProperties: false, required: ['tracknaam', 'artiest', 'youtube_zoekterm', 'reden'],
    properties: {
        tracknaam: { type: 'string' },
        artiest: { type: 'string' },
        youtube_zoekterm: { type: 'string' },
        reden: { type: 'string' },
    },
};

/**
 * Herzoek de nummers die als 'fout' zijn gemarkeerd: vraag ChatGPT om het
 * JUISTE herkenningsnummer en zet ze terug naar 'nieuw' (ronde 1).
 * @returns {Promise<{ok:boolean, hersteld?:number, error?:string}>}
 */
async function herzoekFout({ limiet = 10 } = {}) {
    const { rows } = await pool.query(
        `SELECT * FROM aanbevelingen WHERE status = 'fout' AND soort = 'film_serie'
         ORDER BY aangemaakt_op LIMIT $1`, [limiet]);
    if (!rows.length) return { ok: true, hersteld: 0 };

    let hersteld = 0;
    for (const a of rows) {
        const prompt = `Het herkenningsnummer "${a.tracknaam}" van ${a.artiest} bleek NIET het juiste nummer voor ${a.type} "${a.titel}"${a.jaar ? ` (${a.jaar})` : ''}.

Wat is wél de originele, algemeen bekende soundtrack / titelmuziek / het herkenningsnummer van deze ${a.type}? Geef het juiste nummer, de artiest (of componist / "Titelmuziek"), en een YouTube-zoekterm. Verzin niets: baseer je op web search.`;
        const res = await codex.vraagJson({ prompt, schema: SCHEMA_CORRECTIE });
        if (!res.ok) continue;
        const d = res.data || {};
        if (!d.tracknaam) continue;
        await pool.query(
            `UPDATE aanbevelingen SET tracknaam = $2, artiest = $3, youtube_zoekterm = $4,
                    reden = COALESCE($5, reden), status = 'nieuw', voorbeeld_bron = NULL,
                    beoordeeld_op = NULL
             WHERE id = $1`,
            [a.id, d.tracknaam, d.artiest || 'Onbekend', d.youtube_zoekterm || `${a.titel} soundtrack`, d.reden || null]);
        hersteld++;
    }
    logger.info('Foute nummers herzocht', { hersteld });
    return { ok: true, hersteld };
}

module.exports = { genereer, herzoekFout, SCHEMA_FILM_SERIE, SCHEMA_KERST };
