// =====================================================================
// VenTune — serveringang.
// Draait de migratie bij het opstarten, biedt een health-endpoint en de
// muziek-routes (iTunes), en legt de fundering voor Express + Socket.IO.
// De lobby- en game-logica komt in de volgende stappen.
// =====================================================================

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const logger = require('./lib/logger');
const discord = require('./lib/discord');
const muziekRoutes = require('./routes/muziek');
const lobbyRoutes = require('./routes/lobby');
const { setupSockets } = require('./socket');
const { migreer } = require('./db/migrate');
const { pool } = require('./db/pool');

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
    // 1) Migratie draaien voordat we requests accepteren.
    await migreer();

    const app = express();
    app.use(express.json());

    // Muziek-routes (iTunes zoeken en dekking controleren).
    app.use(muziekRoutes);
    // Lobby-routes (aanmaken, joinen).
    app.use(lobbyRoutes);

    // Health-endpoint: controleert ook of de database antwoordt.
    app.get('/api/health', async (_req, res) => {
        try {
            await pool.query('SELECT 1');
            res.json({ status: 'ok', db: 'ok' });
        } catch (err) {
            logger.fout('Health-check: database onbereikbaar.', {
                melding: err.message,
            });
            res.status(503).json({ status: 'fout', db: 'onbereikbaar' });
        }
    });

    const server = http.createServer(app);

    // Socket.IO: realtime lobby-presence.
    const io = new Server(server, {
        cors: { origin: true, credentials: true },
    });
    setupSockets(io);

    server.listen(PORT, '0.0.0.0', () => {
        logger.info('VenTune-server gestart.', { poort: PORT });
    });

    // Nette afsluiting.
    const afsluiten = async (signaal) => {
        logger.info('Afsluiten…', { signaal });
        server.close();
        await pool.end().catch(() => {});
        process.exit(0);
    };
    process.on('SIGTERM', () => afsluiten('SIGTERM'));
    process.on('SIGINT', () => afsluiten('SIGINT'));
}

// Vang onverwachte fouten en meld ze (optioneel) op Discord.
process.on('uncaughtException', async (err) => {
    logger.fout('Onafgevangen uitzondering.', { melding: err.message, stack: err.stack });
    await discord.meld(`Onafgevangen uitzondering: ${err.message}`, {
        titel: '🔴 VenTune crash',
    });
    process.exit(1);
});

start().catch(async (err) => {
    logger.fout('Server kon niet starten.', { melding: err.message });
    await discord.meld(`Server kon niet starten: ${err.message}`, {
        titel: '🔴 VenTune startfout',
    });
    process.exit(1);
});
