// =====================================================================
// Socket.IO: lobby-presence én spelverloop.
//
// Client → server:
//   'lobby:hallo'  { token }     — (her)verbinden met je sessie-token
//   'spel:start'   {}            — host start het spel
//   'ronde:gok'    { gok }       — titel raden
//   'ronde:hint'   {}            — volgende hint opvragen
//   'ronde:verwijder3' {}        — hulplijn bij meerkeuze
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
                        team_naam: speler.team_naam,
                    },
                    instellingen: speler.instellingen || {},
                    teams: speler.instellingen?.teams || [],
                });

                await stuurSpelers(io, speler.lobby_id, speler.code);
                // Replay de actuele fase direct na (her)verbinden. Zonder
                // deze replay kwam een refresh wel terug in de lobby, maar
                // miste de client de ronde die al bezig was.
                await spel.herstelSocket(socket);
            } catch (err) {
                logger.fout('lobby:hallo mislukt.', { melding: err.message });
                socket.emit('lobby:fout', { melding: 'Er ging iets mis.' });
            }
        });

        socket.on('lobby:instellingen', async ({ instellingen } = {}) => {
            try {
                if (!socket.data.isHost) return;
                const nieuw = await lobby.bewaarInstellingen(socket.data.lobbyId, instellingen);
                io.to(kamerNaam(socket.data.code)).emit('lobby:instellingen', {
                    instellingen: nieuw,
                    teams: nieuw.teams || [],
                });
                await stuurSpelers(io, socket.data.lobbyId, socket.data.code);
            } catch (err) {
                socket.emit('lobby:fout', { melding: err.message });
            }
        });

        socket.on('lobby:team', async ({ teamNaam } = {}) => {
            try {
                const team = await lobby.zetTeam({
                    lobbyId: socket.data.lobbyId,
                    spelerId: socket.data.spelerId,
                    teamNaam,
                });
                socket.emit('lobby:team-ok', { team_naam: team });
                await stuurSpelers(io, socket.data.lobbyId, socket.data.code);
            } catch (err) {
                socket.emit('lobby:fout', { melding: err.message });
            }
        });

        // Handmatig herstel zonder de pagina te vernieuwen. Dit is vooral
        // nuttig als een overgang naar de volgende ronde tijdelijk faalde.
        socket.on('spel:herstel', async () => {
            try {
                await spel.herstelSocket(socket);
            } catch (err) {
                logger.waarschuwing('Spelherstel mislukt.', {
                    melding: err.message,
                });
                socket.emit('spel:fout', {
                    melding: 'Herstellen lukte niet. Probeer het nog een keer.',
                });
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

        // Hulplijn: verwijder drie foute antwoorden bij meerkeuze.
        socket.on('ronde:verwijder3', () => {
            try {
                spel.verwijderDrieFouteOpties(socket);
            } catch (err) {
                logger.waarschuwing('Verwijder-3 hulplijn mislukt.', {
                    melding: err.message,
                });
            }
        });

        // Host: naar de volgende ronde / fase.
        socket.on('ronde:volgende', async () => {
            try {
                await spel.volgende(socket);
            } catch (err) {
                logger.waarschuwing('Volgende mislukt.', { melding: err.message });
            }
        });

        // Host: het fragment opnieuw afspelen.
        socket.on('ronde:herhaal', () => {
            try {
                spel.herhaal(socket);
            } catch (err) {
                logger.waarschuwing('Herhalen mislukt.', { melding: err.message });
            }
        });

        // Host: pauzeren en hervatten.
        socket.on('ronde:pauzeer', () => {
            try {
                spel.pauzeer(socket);
            } catch (err) {
                logger.waarschuwing('Pauzeren mislukt.', { melding: err.message });
            }
        });
        socket.on('ronde:hervat', () => {
            try {
                spel.hervat(socket);
            } catch (err) {
                logger.waarschuwing('Hervatten mislukt.', { melding: err.message });
            }
        });

        // Iedereen: melden dat er iets mis is met de muziek van deze ronde.
        socket.on('ronde:melden', async ({ soort, toelichting } = {}) => {
            try {
                await spel.meldFout(socket, soort, toelichting);
            } catch (err) {
                logger.waarschuwing('Melden mislukt.', { melding: err.message });
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
