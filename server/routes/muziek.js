// =====================================================================
// Muziek-routes: zoeken op iTunes en dekking controleren.
//
//   GET /api/muziek/zoek?term=...&land=NL   → clips met previewUrl
//   GET /api/muziek/dekking?titel=...        → snelle coverage-check
//
// Dit voedt de "Muziek zoeken"-testpagina zodat je per titel (vooral
// Nederlandse) meteen ziet of er bruikbare audio is, en het meteen kunt
// afspelen.
// =====================================================================

const express = require('express');
const itunes = require('../lib/itunes');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/api/muziek/zoek', async (req, res) => {
    const term = String(req.query.term || '');
    const land = req.query.land ? String(req.query.land) : undefined;
    const limiet = req.query.limiet ? Number(req.query.limiet) : undefined;

    if (!term.trim()) {
        return res.status(400).json({ fout: 'Geef een zoekterm op.' });
    }
    try {
        const resultaten = await itunes.zoek(term, { land, limiet });
        res.json({ term, aantal: resultaten.length, resultaten });
    } catch (err) {
        logger.waarschuwing('Muziek zoeken mislukt.', { melding: err.message });
        res.status(502).json({ fout: err.message });
    }
});

router.get('/api/muziek/dekking', async (req, res) => {
    const titel = String(req.query.titel || '');
    const land = req.query.land ? String(req.query.land) : undefined;
    if (!titel.trim()) {
        return res.status(400).json({ fout: 'Geef een titel op.' });
    }
    try {
        const dekking = await itunes.dekkingVoor(titel, { land });
        res.json(dekking);
    } catch (err) {
        res.status(502).json({ fout: err.message });
    }
});

module.exports = router;
