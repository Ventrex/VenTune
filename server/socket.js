// =====================================================================
// Socket.IO-presence voor lobbies.
//
// Events (client → server):
//   'lobby:hallo'  { token }   — (her)verbinden met je sessie-token
//
// Events (server → client):
//   'lobby:welkom'  { speler, code }        — bevestiging na hallo
//   'lobby:spelers' [ {id, naam, ...} ]      — actuele spelerslijst
//   'lobby:fout'    { melding }              — bv. lobby bestaat niet meer
//
// Een speler die de app sluit wordt op 'verbroken' gezet maar blijft in
// de database staan (score behouden). Terugkomen met hetzelfde token zet
// hem weer op 'verbonden'.
// =====================================================================

const lobby = require('./game/lobby');
const logger = require('./lib/logger');

function kamerNaam(code) {
    return `lobby:${code}`;
}

function setupSockets(io) {
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

                // Koppel socket aan speler en kamer.
                socket.data.token = token;
                socket.data.spelerId = speler.id;
                socket.data.lobbyId = speler.lobby_id;
                socket.data.code = speler.code;
                socket.join(kamerNaam(speler.code));

                await lobby.zetVerbonden(token, true);

                socket.emit('lobby:welkom', {
                    code: speler.code,
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

        socket.on('disconnect', async () => {
            const { token, lobbyId, code } = socket.data || {};
            if (!token) return;
            try {
                await lobby.zetVerbonden(token, false);
                await stuurSpelers(io, lobbyId, code);
                logger.debug('Socket verbroken', { id: socket.id, code });
            } catch (err) {
                logger.waarschuwing('Disconnect verwerken mislukt.', {
                    melding: err.message,
                });
            }
        });
    });
}

// Stuur de actuele spelerslijst naar iedereen in de kamer.
async function stuurSpelers(io, lobbyId, code) {
    if (!lobbyId || !code) return;
    const spelers = await lobby.haalSpelers(lobbyId);
    io.to(kamerNaam(code)).emit('lobby:spelers', spelers);
}

module.exports = { setupSockets };
