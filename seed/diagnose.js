// =====================================================================
// Diagnose: controleert in één keer of de muziekbronnen werken en wat er
// in de vragenbank staat. Bedoeld om snel te zien wáárom er te weinig
// speelbare titels zijn.
//
// Gebruik:
//   docker compose exec server node /app/seed/diagnose.js
// =====================================================================

const { pool } = require('../server/db/pool');
const ytzoek = require('../server/lib/ytzoek');
const itunes = require('../server/lib/itunes');

const VOORBEELDEN = [
    { naam: 'Undercover', type: 'serie', taal: 'nl', jaar: 2019 },
    { naam: 'Flodder', type: 'film', taal: 'nl', jaar: 1986 },
    { naam: 'Stranger Things', type: 'serie', taal: 'en', jaar: 2016 },
];

async function main() {
    console.log('=== 1. Database ===');
    try {
        const r = await pool.query(
            `SELECT (SELECT count(*)::int FROM titels) AS titels,
                    (SELECT count(*)::int FROM tracks) AS tracks,
                    (SELECT count(*)::int FROM titels t
                      WHERE EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id))
                      AS speelbaar`,
        );
        const d = r.rows[0];
        console.log(`titels: ${d.titels}`);
        console.log(`tracks: ${d.tracks}`);
        console.log(`speelbare titels (met track): ${d.speelbaar}`);

        const perBron = await pool.query(
            `SELECT bron, count(*)::int AS n FROM tracks GROUP BY bron ORDER BY n DESC`,
        );
        for (const rij of perBron.rows) {
            console.log(`  bron ${rij.bron}: ${rij.n}`);
        }

        // Titels zonder jaar vallen buiten elke periodefilter.
        const zonderJaar = await pool.query(
            `SELECT count(*)::int AS n FROM titels WHERE jaar IS NULL`,
        );
        if (zonderJaar.rows[0].n > 0) {
            console.log(
                `  LET OP: ${zonderJaar.rows[0].n} titels zonder jaar — die vallen buiten de periodefilter.`,
            );
        }
    } catch (err) {
        console.log('DB-fout:', err.message);
    }

    console.log('\n=== 2. YouTube bereikbaar? ===');
    console.log(
        `API-key ingesteld: ${process.env.YOUTUBE_API_KEY ? 'ja' : 'nee (gebruikt publieke zoekpagina)'}`,
    );
    for (const t of VOORBEELDEN) {
        const term = ytzoek.zoektermVoor(t);
        try {
            const res = await ytzoek.zoek(term, { limiet: 5 });
            console.log(`"${term}" -> ${res.length} resultaten`);
            for (const v of res.slice(0, 3)) {
                console.log(
                    `   • ${v.titel} | views: ${v.views ?? '?'} | duur: ${v.duurSeconden ?? '?'}s`,
                );
            }
            if (res.length === 0) {
                console.log(
                    '   WAARSCHUWING: 0 resultaten — YouTube geeft mogelijk een cookiemuur.',
                );
            }
            const keuze = ytzoek.kiesBeste(res, t);
            console.log(`   gekozen: ${keuze ? keuze.titel : 'GEEN (niets bruikbaars)'}`);
        } catch (err) {
            console.log(`"${term}" -> FOUT: ${err.message}`);
        }
    }

    console.log('\n=== 3. iTunes bereikbaar? ===');
    try {
        const res = await itunes.zoek('Interstellar soundtrack', { limiet: 3 });
        console.log(`iTunes gaf ${res.length} resultaten met preview.`);
    } catch (err) {
        console.log('iTunes FOUT:', err.message);
    }

    console.log('\n=== Klaar ===');
    console.log(
        'Weinig speelbare titels? Draai dan:\n' +
            '  node /app/seed/import.js --force',
    );
    await pool.end();
}

main().catch(async (err) => {
    console.error('Diagnose mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
