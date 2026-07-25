// =====================================================================
// Vragen genereren voor alle titels. Zorgt dat elke titel meerdere
// bonusvragen heeft, zodat je bij dezelfde titel niet steeds dezelfde
// vraag krijgt.
//
// Gebruik (in de servercontainer):
//   node /app/seed/vragen-import.js              # basisvragen (snel, offline)
//   node /app/seed/vragen-import.js --tmdb       # ook regisseur/acteur (langzamer)
//   node /app/seed/vragen-import.js --minimaal 5 # streef naar 5 per titel
// =====================================================================

const { pool } = require('../server/db/pool');
const vragenbank = require('../server/game/vragen');

const args = process.argv.slice(2);
const METTMDB = args.includes('--tmdb');
function arg(naam, standaard) {
    const i = args.indexOf(`--${naam}`);
    return i >= 0 ? Number(args[i + 1]) : standaard;
}
const MINIMAAL = arg('minimaal', 3);
const LIMIET = arg('limit', Infinity);

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    // Alleen titels die daadwerkelijk speelbaar zijn (met muziek).
    const { rows: titels } = await pool.query(
        `SELECT t.id, t.naam, t.type, t.taal, t.jaar, t.land, t.genres, t.tmdb_id
           FROM titels t
          WHERE EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id)
          ORDER BY t.stemmen DESC NULLS LAST, t.id`,
    );
    console.log(
        `${titels.length} speelbare titels. Streven: minstens ${MINIMAAL} vragen per titel.` +
            (METTMDB ? ' Inclusief TMDB-vragen.' : ''),
    );

    let nieuw = 0;
    let behandeld = 0;
    for (const t of titels) {
        if (behandeld >= LIMIET) break;
        behandeld++;
        try {
            const n = await vragenbank.vulAan(t, MINIMAAL, METTMDB);
            nieuw += n;
            if (n > 0 && behandeld % 50 === 0) {
                console.log(`  ${behandeld}/${titels.length} … ${nieuw} vragen`);
            }
        } catch (err) {
            console.log(`  ${t.naam}: ${err.message}`);
        }
        if (METTMDB) await slaap(120); // vriendelijk voor TMDB
    }

    const d = await pool.query(
        `SELECT count(*)::int AS vragen,
                count(DISTINCT titel_id)::int AS titels,
                round(avg(per_titel), 1) AS gemiddeld
           FROM vragen,
                LATERAL (SELECT count(*)::int AS per_titel
                           FROM vragen v2 WHERE v2.titel_id = vragen.titel_id) s`,
    );

    console.log('\n=== Samenvatting ===');
    console.log(`Nieuwe vragen: ${nieuw}`);
    console.log(`Totaal vragen: ${d.rows[0].vragen} over ${d.rows[0].titels} titels`);
    console.log(`Gemiddeld per titel: ${d.rows[0].gemiddeld}`);

    const soorten = await pool.query(
        `SELECT soort, count(*)::int AS n FROM vragen GROUP BY soort ORDER BY n DESC`,
    );
    console.log('\nPer soort:');
    for (const s of soorten.rows) console.log(`  ${s.soort}: ${s.n}`);

    await pool.end();
}

main().catch(async (err) => {
    console.error('Vragen-import mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
