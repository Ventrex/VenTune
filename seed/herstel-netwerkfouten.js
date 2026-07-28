// =====================================================================
// Zet titels terug in de wachtrij die zijn afgekeurd door een netwerk-
// storing in plaats van door een echt gebrek aan muziek.
//
// Waarom: "fetch failed" zegt niets over de titel. Een storing van een
// half uur kon zo honderden goede titels op 'opgegeven' zetten.
//
// Gebruik (in de servercontainer):
//   node /app/seed/herstel-netwerkfouten.js          # rapport
//   node /app/seed/herstel-netwerkfouten.js --ja     # herstellen
//   node /app/seed/herstel-netwerkfouten.js --ja --alles   # ook de rest
// =====================================================================

const { pool } = require('../server/db/pool');

const args = process.argv.slice(2);
const DOEN = args.includes('--ja');
const ALLES = args.includes('--alles');

// Meldingen die op een storing wijzen, niet op een titel zonder muziek.
const STORING = [
    '%fetch failed%',
    '%niet bereikbaar%',
    '%ECONNRESET%',
    '%ETIMEDOUT%',
    '%ENOTFOUND%',
    '%EAI_AGAIN%',
    '%socket hang up%',
    '%status 429%',
    '%status 403%',
    '%timeout%',
];

async function main() {
    const waar = ALLES
        ? `zoek_status IN ('geen_kandidaat', 'opgegeven')`
        : `zoek_status IN ('geen_kandidaat', 'opgegeven')
             AND zoek_melding ILIKE ANY($1::text[])`;
    const params = ALLES ? [] : [STORING];

    const { rows } = await pool.query(
        `SELECT zoek_melding, count(*)::int AS n
           FROM titels
          WHERE ${waar}
          GROUP BY zoek_melding
          ORDER BY n DESC
          LIMIT 20`,
        params,
    );

    const totaal = await pool.query(
        `SELECT count(*)::int AS n FROM titels WHERE ${waar}`,
        params,
    );
    const aantal = totaal.rows[0].n;

    console.log(
        ALLES
            ? `${aantal} titels staan als geen_kandidaat/opgegeven.`
            : `${aantal} titels zijn afgekeurd door een storing (niet door ontbrekende muziek).`,
    );
    if (rows.length) {
        console.log('\nMeest voorkomende meldingen:');
        for (const r of rows) {
            console.log(`  ${String(r.n).padStart(5)}×  ${r.zoek_melding || '(geen melding)'}`);
        }
    }

    if (!DOEN) {
        console.log(
            '\nNiets gewijzigd. Herstellen:\n' +
                '  node /app/seed/herstel-netwerkfouten.js --ja\n' +
                'Alles terugzetten (ook titels waar echt niets te vinden was):\n' +
                '  node /app/seed/herstel-netwerkfouten.js --ja --alles',
        );
        await pool.end();
        return;
    }

    const uit = await pool.query(
        `UPDATE titels
            SET zoek_status = 'nieuw',
                zoek_pogingen = 0,
                volgende_poging = NULL,
                zoek_melding = NULL
          WHERE ${waar}`,
        params,
    );
    console.log(`\n${uit.rowCount} titels staan weer in de wachtrij.`);
    console.log('Zoek nu opnieuw:');
    console.log('  node /app/seed/import.js --db');

    await pool.end();
}

main().catch(async (err) => {
    console.error('Herstel mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
