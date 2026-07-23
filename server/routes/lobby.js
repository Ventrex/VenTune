// =====================================================================
// Lobby-routes (REST).
//
//   POST /api/lobby                 → host maakt een spel (code + token)
//   GET  /api/lobby/:code           → bestaat de lobby? (voor de joinpagina)
//   POST /api/lobby/:code/join      → speler doet mee (naam → token)
//
// De realtime-presence (spelerslijst, verbinden/verbreken) loopt via
// Socket.IO — zie server/socket.js.
// =====================================================================

const express = require('express');
const lobby = require('../game/lobby');
const logger = require('../lib/logger');
const discord = require('../lib/discord');

const router = express.Router();

// Host maakt een nieuw spel.
router.post('/api/lobby', async (req, res) => {
    try {
        const hostNaam = (req.body && req.body.naam) || 'Host';
        const instellingen = (req.body && req.body.instellingen) || {};
        const resultaat = await lobby.maakLobby({ hostNaam, instellingen });

        logger.info('Nieuwe lobby aangemaakt.', { code: resultaat.code });
        await discord.meld(`Nieuwe lobby **${resultaat.code}** aangemaakt.`, {
            titel: '🎬 VenTune lobby',
        });

        res.json({
            code: resultaat.code,
            token: resultaat.hostToken,
            spelerId: resultaat.hostSpelerId,
            is_host: true,
        });
    } catch (err) {
        logger.fout('Lobby aanmaken mislukt.', { melding: err.message });
        res.status(500).json({ fout: 'Kon geen lobby aanmaken.' });
    }
});

// Bestaat de lobby? (joinpagina controleert dit voordat je een naam typt)
router.get('/api/lobby/:code', async (req, res) => {
    const gevonden = await lobby.haalLobby(req.params.code);
    if (!gevonden) {
        return res.status(404).json({ bestaat: false });
    }
    res.json({
        bestaat: true,
        code: gevonden.code,
        status: gevonden.status,
        kan_joinen: gevonden.status === 'wachten',
    });
});

// Speler doet mee.
router.post('/api/lobby/:code/join', async (req, res) => {
    try {
        const naam = req.body && req.body.naam;
        const resultaat = await lobby.doeMee({ code: req.params.code, naam });
        logger.info('Speler deed mee.', { code: req.params.code });
        res.json({
            token: resultaat.token,
            spelerId: resultaat.spelerId,
            code: String(req.params.code).toUpperCase(),
            is_host: false,
        });
    } catch (err) {
        res.status(400).json({ fout: err.message });
    }
});

module.exports = router;
