// =====================================================================
// Muziek opruimen. Verwijdert tracks zodat ze opnieuw gezocht kunnen
// worden — handig als er verkeerde nummers aan titels hangen.
//
// De titels zelf blijven staan; alleen de gekoppelde muziek gaat weg.
//
// Gebruik (in de servercontainer):
//   node /app/seed/reset-tracks.js --ja                 # alles
//   node /app/seed/reset-tracks.js --ja --bron itunes   # alleen iTunes
//   node /app/seed/reset-tracks.js --ja --titel "Gooische"
// =====================================================================

const { pool } = require('../server/db/pool');

const args = process.argv.slice(2);
function optie(naam) {
    const i = args.indexOf(`--${naam}`);
    return i >= 0 ? args[i + 1] : null;
}

async function main() {
    const bron = optie('bron'); // itunes | youtube | lokaal
    const titel = optie('titel');

    const condities = [];
    const params = [];
    if (bron) {
        params.push(bron);
        condities.push(`bron = $${params.length}`);
    }
    if (titel) {
        params.push(`%${titel}%`);
        condities.push(
            `titel_id IN (SELECT id FROM titels WHERE naam ILIKE $${params.length})`,
        );
    }
    const where = condities.length ? `WHERE ${condities.join(' AND ')}` : '';

    const telling = await pool.query(
        `SELECT count(*)::int AS n FROM tracks ${where}`,
        params,
    );
    const aantal = telling.rows[0].n;

    console.log(`Te verwijderen tracks: ${aantal}`);
    if (bron) console.log(`  beperkt tot bron: ${bron}`);
    if (titel) console.log(`  beperkt tot titels met: "${titel}"`);

    if (!args.includes('--ja')) {
        console.log(
            '\nNiets verwijderd. Voeg --ja toe om het echt te doen, bijvoorbeeld:\n' +
                '  node /app/seed/reset-tracks.js --ja',
        );
        await pool.end();
        return;
    }

    const uit = await pool.query(`DELETE FROM tracks ${where}`, params);
    console.log(`\n${uit.rowCount} tracks verwijderd.`);

    const rest = await pool.query(
        `SELECT (SELECT count(*)::int FROM titels) AS titels,
                (SELECT count(*)::int FROM tracks) AS tracks`,
    );
    console.log(
        `Nu in database: ${rest.rows[0].titels} titels, ${rest.rows[0].tracks} tracks.`,
    );
    console.log('\nOpnieuw vullen:');
    console.log('  node /app/seed/playlist-import.js      (beste kwaliteit)');
    console.log('  node /app/seed/import.js --db          (zoeken voor de rest)');

    await pool.end();
}

main().catch(async (err) => {
    console.error('Opruimen mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
