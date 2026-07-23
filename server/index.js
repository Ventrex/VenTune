// =====================================================================
// VenTune — serveringang.
// In deze eerste stap: draait de migratie bij het opstarten, biedt een
// health-endpoint, en legt de fundering voor Express + Socket.IO.
// De echte lobby-, auth- en game-logica komt in de volgende stappen.
// =====================================================================

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const logger = require('./lib/logger');
const discord = require('./lib/discord');
const spotify = require('./lib/spotify');
const authRoutes = require('./routes/auth');
const { migreer } = require('./db/migrate');
const { pool } = require('./db/pool');

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
    // 1) Migratie draaien voordat we requests accepteren.
    await migreer();

    const app = express();
    app.use(express.json());

    // Auth- en Spotify-routes (login, callback, profiel, token).
    app.use(authRoutes);

    // Proactieve token-vernieuwing starten (elke 60s).
    spotify.startAchtergrondVernieuwing();

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

    // Socket.IO alvast opzetten (join-events komen in een latere stap).
    const io = new Server(server, {
        cors: { origin: true, credentials: true },
    });

    io.on('connection', (socket) => {
        logger.debug('Socket verbonden', { id: socket.id });
        socket.on('disconnect', () => {
            logger.debug('Socket verbroken', { id: socket.id });
        });
    });

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
