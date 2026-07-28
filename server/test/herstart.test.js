// =====================================================================
// Test: een tweede spel in dezelfde lobby mag niet stuklopen.
//
// rondes heeft UNIQUE (lobby_id, rondenummer). Zonder de rondes van het
// vorige spel op te ruimen botst een herstart meteen op ronde 1 met
// "duplicate key value violates unique constraint".
//
// Draait alleen met TEST_DATABASE_URL.
// =====================================================================

const url = process.env.TEST_DATABASE_URL;
if (!url) {
    console.log('herstart: overgeslagen (TEST_DATABASE_URL ontbreekt)');
    process.exit(0);
}
process.env.DATABASE_URL = url;

const { pool } = require('../db/pool');

let mislukt = 0;
function check(naam, waar, extra) {
    if (!waar) {
        mislukt++;
        console.error(`FOUT: ${naam}${extra ? ` → ${extra}` : ''}`);
    }
}

async function main() {
    await pool.query(`DELETE FROM titels WHERE naam = 'HerstartTest'`);
    const titel = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, genres)
         VALUES ('HerstartTest', '{}', 'film', 'nl', 2000, '{}') RETURNING id`,
    );
    const titelId = titel.rows[0].id;
    const track = await pool.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, tracknaam, artiest,
                             download_status)
         VALUES ($1, 'lokaal', '/media/downloads/herstart.mp3', 'Test', 'Test',
                 'available') RETURNING id`,
        [titelId],
    );
    const trackId = track.rows[0].id;

    const lobby = await pool.query(
        `INSERT INTO lobbies (code, status) VALUES ('TSTX', 'wachten') RETURNING id`,
    );
    const lobbyId = lobby.rows[0].id;

    async function speelRonde(nummer) {
        await pool.query(
            `INSERT INTO rondes (lobby_id, rondenummer, titel_id, track_id,
                                 start_ms, duur_ms, status)
             VALUES ($1, $2, $3, $4, 0, 30000, 'raden')`,
            [lobbyId, nummer, titelId, trackId],
        );
    }

    // Eerste spel: twee rondes.
    await speelRonde(1);
    await speelRonde(2);

    // Tweede spel zónder opruimen botst — dat was de fout die de host zag.
    let botsing = null;
    try {
        await speelRonde(1);
    } catch (err) {
        botsing = err.message;
    }
    check(
        'zonder opruimen botst ronde 1 (bevestigt de oorzaak)',
        botsing && botsing.includes('duplicate key'),
        String(botsing),
    );

    // Mét opruimen, zoals startSpel nu doet, kan het gewoon opnieuw.
    await pool.query(`DELETE FROM rondes WHERE lobby_id = $1`, [lobbyId]);
    let nogmaals = null;
    try {
        await speelRonde(1);
        await speelRonde(2);
    } catch (err) {
        nogmaals = err.message;
    }
    check('na opruimen start het tweede spel gewoon', nogmaals === null, String(nogmaals));

    const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM rondes WHERE lobby_id = $1`,
        [lobbyId],
    );
    check('alleen de rondes van het nieuwe spel blijven over', rows[0].n === 2, String(rows[0].n));

    await pool.query(`DELETE FROM lobbies WHERE id = $1`, [lobbyId]);
    await pool.query(`DELETE FROM titels WHERE id = $1`, [titelId]);
    await pool.end();

    if (mislukt > 0) {
        console.error(`herstart: ${mislukt} test(s) mislukt`);
        process.exit(1);
    }
    console.log('herstart: een tweede spel in dezelfde lobby start gewoon');
}

main().catch(async (err) => {
    console.error('herstart: test mislukt', err);
    await pool.end().catch(() => {});
    process.exit(1);
});
