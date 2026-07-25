// =====================================================================
// Zoekcache in de database. Onthoudt wat er al bij YouTube of iTunes is
// opgehaald, zodat dezelfde zoekopdracht niet telkens opnieuw hoeft.
//
// Waarom: bij duizenden titels loop je anders tegen 429/403-limieten aan,
// en een import die je opnieuw start begint weer van voren af aan. Met deze
// cache groeit de vragenbank stap voor stap en blijft eerder werk bewaard.
// =====================================================================

const { pool } = require('../db/pool');
const logger = require('./logger');

// Hoe lang een cache-regel bruikbaar blijft (dagen).
const GELDIG_DAGEN = 60;

/**
 * Haal een eerder resultaat op.
 * @returns {Promise<Array|null>} de opgeslagen items, of null als er niets is
 */
async function lees(bron, term) {
    try {
        const { rows } = await pool.query(
            `SELECT resultaat FROM zoek_cache
              WHERE bron = $1 AND term = $2
                AND opgehaald_op > now() - ($3 || ' days')::interval`,
            [bron, term, String(GELDIG_DAGEN)],
        );
        return rows[0] ? rows[0].resultaat : null;
    } catch (err) {
        // Zonder cache werkt alles nog, alleen langzamer.
        logger.waarschuwing('Cache lezen mislukt.', { melding: err.message });
        return null;
    }
}

/** Bewaar een resultaat (overschrijft een bestaande regel). */
async function schrijf(bron, term, resultaat) {
    try {
        await pool.query(
            `INSERT INTO zoek_cache (bron, term, resultaat, aantal)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (bron, term) DO UPDATE SET
                resultaat    = EXCLUDED.resultaat,
                aantal       = EXCLUDED.aantal,
                opgehaald_op = now()`,
            [bron, term, JSON.stringify(resultaat), (resultaat || []).length],
        );
    } catch (err) {
        logger.waarschuwing('Cache schrijven mislukt.', { melding: err.message });
    }
}

/**
 * Haal iets op via de cache: bestaat het al, gebruik dat; anders de
 * meegegeven functie uitvoeren en het resultaat bewaren.
 */
async function viaCache(bron, term, ophalen) {
    const bestaand = await lees(bron, term);
    if (bestaand) return { resultaat: bestaand, uitCache: true };
    const nieuw = await ophalen();
    if (nieuw && nieuw.length > 0) await schrijf(bron, term, nieuw);
    return { resultaat: nieuw, uitCache: false };
}

/** Hoeveel regels staan er in de cache? (voor diagnose) */
async function statistiek() {
    try {
        const { rows } = await pool.query(
            `SELECT bron, count(*)::int AS regels, sum(aantal)::int AS items
               FROM zoek_cache GROUP BY bron ORDER BY regels DESC`,
        );
        return rows;
    } catch {
        return [];
    }
}

module.exports = { lees, schrijf, viaCache, statistiek };
