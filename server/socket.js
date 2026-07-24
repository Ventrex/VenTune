// =====================================================================
// Socket.IO: lobby-presence én spelverloop.
//
// Client → server:
//   'lobby:hallo'  { token }     — (her)verbinden met je sessie-token
//   'spel:start'   {}            — host start het spel
//   'ronde:gok'    { gok }       — titel raden
//   'ronde:hint'   {}            — volgende hint opvragen
//
// Server → client (o.a.):
//   'lobby:welkom', 'lobby:spelers', 'lobby:fout'
//   'ronde:start', 'ronde:audio' (host), 'ronde:resultaat', 'ronde:hint'
//   'ronde:afgelopen', 'spel:scores', 'spel:einde', 'spel:fout'
//
// Een speler die de app sluit blijft in de database staan (score behouden)
// en keert terug met hetzelfde token.
// =====================================================================

const lobby = require('./game/lobby');
const { pool } = require('./db/pool');
const { SpelBeheer } = require('./game/engine');
const logger = require('./lib/logger');

function kamerNaam(code) {
    return `lobby:${code}`;
}

function setupSockets(io) {
    const spel = new SpelBeheer(io);

    io.on('connection', (socket) => {
        logger.debug('Socket verbonden', { id: socket.id });

        // (Her)verbinden met een sessie-token.
        socket.on('lobby:hallo', async ({ token } = {}) => {
            try {
                const speler = await lobby.haalSpelerViaToken(token);
                if (!speler) {
                    socket.emit('lobby:fout', {
                        melding: 'Sessie niet gevonden of lobby afgelopen.',
                    });
                    return;
                }

                socket.data.token = token;
                socket.data.spelerId = speler.id;
                socket.data.lobbyId = speler.lobby_id;
                socket.data.code = speler.code;
                socket.data.isHost = speler.is_host;

                socket.join(kamerNaam(speler.code));
                socket.join(`speler:${speler.id}`);
                if (speler.is_host) socket.join(`host:${speler.code}`);

                await lobby.zetVerbonden(token, true);

                socket.emit('lobby:welkom', {
                    code: speler.code,
                    status: speler.status,
                    bezig: spel.heeftSpel(speler.lobby_id),
                    speler: {
                        id: speler.id,
                        naam: speler.naam,
                        is_host: speler.is_host,
                        score: speler.score,
                    },
                });

                await stuurSpelers(io, speler.lobby_id, speler.code);
            } catch (err) {
                logger.fout('lobby:hallo mislukt.', { melding: err.message });
                socket.emit('lobby:fout', { melding: 'Er ging iets mis.' });
            }
        });

        // Host start het spel.
        socket.on('spel:start', async () => {
            try {
                if (!socket.data.isHost || !socket.data.lobbyId) return;
                const { rows } = await pool.query(
                    `SELECT instellingen FROM lobbies WHERE id = $1`,
                    [socket.data.lobbyId],
                );
                if (!rows[0]) return;
                await spel.startSpel({
                    lobbyId: socket.data.lobbyId,
                    code: socket.data.code,
                    instellingen: rows[0].instellingen || {},
                });
            } catch (err) {
                logger.fout('spel:start mislukt.', { melding: err.message });
                socket.emit('spel:fout', { melding: 'Kon het spel niet starten.' });
            }
        });

        // Titel raden.
        socket.on('ronde:gok', async ({ gok } = {}) => {
            try {
                await spel.verwerkGok(socket, String(gok || ''));
            } catch (err) {
                logger.waarschuwing('Gok verwerken mislukt.', {
                    melding: err.message,
                });
            }
        });

        // Hint opvragen.
        socket.on('ronde:hint', async () => {
            try {
                await spel.vraagHint(socket);
            } catch (err) {
                logger.waarschuwing('Hint mislukt.', { melding: err.message });
            }
        });

        // Bonusvraag beantwoorden.
        socket.on('ronde:bonus-antwoord', async ({ keuze } = {}) => {
            try {
                await spel.verwerkBonus(socket, keuze);
            } catch (err) {
                logger.waarschuwing('Bonus verwerken mislukt.', {
                    melding: err.message,
                });
            }
        });

        socket.on('disconnect', async () => {
            const { token, lobbyId, code } = socket.data || {};
            if (!token) return;
            try {
                await lobby.zetVerbonden(token, false);
                await stuurSpelers(io, lobbyId, code);
            } catch (err) {
                logger.waarschuwing('Disconnect verwerken mislukt.', {
                    melding: err.message,
                });
            }
        });
    });
}

async function stuurSpelers(io, lobbyId, code) {
    if (!lobbyId || !code) return;
    const spelers = await lobby.haalSpelers(lobbyId);
    io.to(kamerNaam(code)).emit('lobby:spelers', spelers);
}

module.exports = { setupSockets };
