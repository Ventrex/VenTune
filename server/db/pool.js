// =====================================================================
// Gedeelde PostgreSQL-connectiepool.
// Alle modules importeren dezelfde pool zodat verbindingen hergebruikt
// worden.
// =====================================================================

const { Pool } = require('pg');
const logger = require('../lib/logger');

if (!process.env.DATABASE_URL) {
    logger.fout('DATABASE_URL ontbreekt in de omgeving.');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Redelijke standaardwaarden voor een homelab-opzet.
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    logger.fout('Onverwachte fout op inactieve DB-client', { melding: err.message });
});

module.exports = { pool };
