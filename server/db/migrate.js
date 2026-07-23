// =====================================================================
// Migratiescript: voert db/schema.sql uit tegen de database.
// Idempotent — kan bij elke serverstart veilig opnieuw draaien.
//
// Wacht eerst tot PostgreSQL bereikbaar is (handig in Docker waar de
// db-container net iets later klaar kan zijn dan de server).
//
// Gebruik:
//   node db/migrate.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
const logger = require('../lib/logger');

const SCHEMA_PAD = path.join(__dirname, 'schema.sql');
const MAX_POGINGEN = 15;
const WACHT_MS = 2000;

function slaap(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wachtOpDatabase() {
    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
        try {
            await pool.query('SELECT 1');
            logger.info('Databaseverbinding beschikbaar.');
            return;
        } catch (err) {
            logger.waarschuwing('Wachten op database…', {
                poging,
                van: MAX_POGINGEN,
                melding: err.message,
            });
            await slaap(WACHT_MS);
        }
    }
    throw new Error('Kon geen verbinding maken met de database na meerdere pogingen.');
}

async function migreer() {
    await wachtOpDatabase();

    const sql = fs.readFileSync(SCHEMA_PAD, 'utf8');
    logger.info('Schema wordt toegepast…', { bestand: 'schema.sql' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        logger.info('Migratie geslaagd.');
    } catch (err) {
        await client.query('ROLLBACK');
        logger.fout('Migratie mislukt, wijzigingen teruggedraaid.', {
            melding: err.message,
        });
        throw err;
    } finally {
        client.release();
    }
}

// Zorg dat het script ook los aangeroepen kan worden.
if (require.main === module) {
    migreer()
        .then(async () => {
            await pool.end();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.fout('Migratie afgebroken.', { melding: err.message });
            await pool.end().catch(() => {});
            process.exit(1);
        });
}

module.exports = { migreer };
