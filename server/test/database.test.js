// Draait lokaal over als TEST_DATABASE_URL ontbreekt. In CI wordt PostgreSQL
// gestart en testen we de echte tabellen plus de laatste trackcontrole.
if (!process.env.TEST_DATABASE_URL) {
    console.log('database: overgeslagen (TEST_DATABASE_URL ontbreekt)');
    process.exit(0);
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const assert = require('assert/strict');
const { pool } = require('../db/pool');
const { pastBijTitel } = require('../lib/trackcheck');

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const titel = await client.query(
            `INSERT INTO titels (naam, aliassen, type, taal, jaar)
             VALUES ('Flodder', ARRAY['Flodder test'], 'serie', 'nl', 1986)
             RETURNING id, naam, aliassen, jaar`,
        );
        const titelRij = titel.rows[0];
        await client.query(
            `INSERT INTO tracks
                (titel_id, bron, preview_url, tracknaam, artiest, werkt,
                 gecontroleerd, verificatie_score)
             VALUES
                ($1, 'youtube', 'wrong', 'Gooische Vrouwen titelsong', 'Test', true, true, 1),
                ($1, 'youtube', 'right', 'Flodder intro (1986)', 'Test', true, true, 0.9)`,
            [titelRij.id],
        );
        const { rows } = await client.query(
            `SELECT id, bron, preview_url, tracknaam, artiest, album,
                    verificatie_score
               FROM tracks
              WHERE titel_id = $1 AND werkt = true
              ORDER BY verificatie_score DESC, id ASC`,
            [titelRij.id],
        );
        const gekozen = rows.find((track) => pastBijTitel(titelRij, track).past);
        assert.equal(gekozen.preview_url, 'right');
        await client.query('ROLLBACK');
        console.log('database: verkeerde track wordt overgeslagen');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
