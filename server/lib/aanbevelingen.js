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
                required: ['titel', 'type', 'jaar', 'tracknaam', 'artiest',
                           'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    titel: { type: 'string' },
                    type: { type: 'string', enum: ['film', 'serie'] },
                    jaar: { type: 'integer' },
                    genres: { type: 'array', items: { type: 'string' } },
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
                required: ['tracknaam', 'artiest', 'jaar', 'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    tracknaam: { type: 'string' },
                    artiest: { type: 'string' },
                    jaar: { type: 'integer' },
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

Geef ${aantal} kandidaten: elk een bekende film of serie met het ALGEMEEN BEKENDE herkenningsnummer dat er echt bij hoort — de theme song, titelmuziek of een iconisch nummer uit die film/serie. Voorbeelden van het soort: de titelmuziek van The Office, het thema van Terminator, de titelsong van een bekende serie.

Harde eisen:
- Alleen films/series met een GOEDE FANBASE. Geen obscure of nauwelijks bekende titels.
- Het nummer moet echt en herkenbaar bij die titel horen (geen willekeurig liedje).
- Vul 'bekendheid' 1..5: 5 = vrijwel iedereen kent titel én nummer, 1 = alleen fans. Geef niets onder de 3.
- 'youtube_zoekterm': een zoekterm waarmee je het nummer op YouTube vindt (bv. "The Office theme song").
- 'reden': één korte zin waarom dit nummer bekend is bij deze titel.
${taalregel}${uitsluiten}`;
}

function promptKerst({ aantal, bestaand }) {
    const uitsluiten = (bestaand && bestaand.length)
        ? `\n\nDeze nummers zitten al in de database, sla ze over:\n- ${bestaand.slice(0, 200).join('\n- ')}`
        : '';
    return `Je helpt een kerstmuziek-quiz vullen. In het spel moeten spelers de zanger, het nummer en het jaartal raden.

Geef ${aantal} kandidaten: algemeen bekende kerstliedjes die vrijwel iedereen kent (bv. de grote kersthits die elk jaar overal klinken).

Harde eisen:
- Alleen ECHT BEKENDE kerstliedjes met een brede fanbase. Geen obscure nummers.
- Geef het jaar van de originele/bekendste uitgave zo nauwkeurig mogelijk.
- Vul 'bekendheid' 1..5: 5 = iedereen kent het, 1 = alleen liefhebbers. Geef niets onder de 3.
- 'youtube_zoekterm': waarmee je het nummer op YouTube vindt (bv. "Wham Last Christmas").
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
    const aantal = Math.min(40, Math.max(1, opties.aantal || 15));
    const minBek = opties.minBekendheid || 3;

    const bestaand = await bestaandeNamen(soort).catch(() => []);

    const prompt = soort === 'kerst'
        ? promptKerst({ aantal, bestaand })
        : promptFilmSerie({ aantal, taal: opties.taal || 'beide', bestaand });
    const schema = soort === 'kerst' ? SCHEMA_KERST : SCHEMA_FILM_SERIE;

    const res = await codex.vraagJson({ prompt, schema, signal: opties.signal });
    if (!res.ok) return { ok: false, error: res.error };

    const lijst = Array.isArray(res.data && res.data.kandidaten) ? res.data.kandidaten : [];
    let toegevoegd = 0;
    let overgeslagen = 0;

    for (const k of lijst) {
        if (!k || (k.bekendheid || 0) < minBek) { overgeslagen++; continue; }
        try {
            const r = await pool.query(
                `INSERT INTO aanbevelingen
                    (soort, titel, type, jaar, genres, tracknaam, artiest,
                     youtube_zoekterm, bekendheid, reden, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'nieuw')
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
                ],
            );
            if (r.rows[0]) toegevoegd++; else overgeslagen++;
        } catch (err) {
            logger.waarschuwing('Aanbeveling niet opgeslagen', { melding: err.message });
            overgeslagen++;
        }
    }

    logger.info('Aanbevelingen gegenereerd', { soort, toegevoegd, overgeslagen });
    return { ok: true, toegevoegd, overgeslagen };
}

module.exports = { genereer, SCHEMA_FILM_SERIE, SCHEMA_KERST };
