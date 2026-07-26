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

// Een geslaagde controle mag minstens een week worden overgeslagen. Dit is
// bewust korter dan de bewaartermijn van de database: oude zoekresultaten
// blijven als historie beschikbaar, maar worden na een week opnieuw getoetst.
const GELDIG_DAGEN = 7;

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

/** Bewaar een resultaat (ook een lege lijst, zodat missers niet blijven loopen). */
async function schrijf(bron, term, resultaat) {
    try {
        await pool.query(
            `INSERT INTO zoek_cache (bron, term, resultaat, aantal)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (bron, term) DO UPDATE SET
                resultaat    = EXCLUDED.resultaat,
                aantal       = EXCLUDED.aantal,
                opgehaald_op = now()`,
            [bron, term, JSON.stringify(Array.isArray(resultaat) ? resultaat : []), (resultaat || []).length],
        );
    } catch (err) {
        logger.waarschuwing('Cache schrijven mislukt.', { melding: err.message });
    }
}

/** Leg iedere externe of gecachete zoekactie vast voor diagnose en beheer. */
async function noteerZoekopdracht(bron, term, opties = {}) {
    try {
        await pool.query(
            `INSERT INTO zoek_log
                (bron, term, limiet, uit_cache, resultaat_aantal, status, melding)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                bron,
                String(term || '').slice(0, 500),
                Number.isFinite(Number(opties.limiet)) ? Number(opties.limiet) : null,
                opties.uitCache === true,
                Array.isArray(opties.resultaat) ? opties.resultaat.length : 0,
                opties.status || 'ok',
                opties.melding ? String(opties.melding).slice(0, 500) : null,
            ],
        );
    } catch (err) {
        // Zoekfunctionaliteit mag niet stukgaan omdat een auditregel niet
        // kan worden opgeslagen tijdens een oude database-migratie.
        logger.waarschuwing('Zoekopdracht loggen mislukt.', { melding: err.message });
    }
}

/**
 * Haal iets op via de cache: bestaat het al, gebruik dat; anders de
 * meegegeven functie uitvoeren en het resultaat bewaren.
 */
async function viaCache(bron, term, ophalen) {
    const bestaand = await lees(bron, term);
    if (bestaand !== null) {
        await noteerZoekopdracht(bron, term, { uitCache: true, resultaat: bestaand });
        return { resultaat: bestaand, uitCache: true };
    }
    const nieuw = await ophalen();
    await schrijf(bron, term, nieuw || []);
    await noteerZoekopdracht(bron, term, { resultaat: nieuw || [] });
    return { resultaat: nieuw || [], uitCache: false };
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

module.exports = { lees, schrijf, viaCache, noteerZoekopdracht, statistiek, GELDIG_DAGEN };
