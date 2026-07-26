// =====================================================================
// Setup-routes: telling van beschikbare titels en presets.
//
//   GET    /api/tracks/telling?categorie=&taal=&start=&eind=
//   GET    /api/presets
//   POST   /api/presets
//   DELETE /api/presets/:id
//
// De telling voedt het laatste filterscherm: onder de drempel mag de host
// niet starten.
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const { bouwFilter } = require('../game/filters');
const logger = require('../lib/logger');

const router = express.Router();

// Minimaal aantal speelbare titels om te mogen starten.
const MIN_TITELS = 15;

// Publieke collectieknoppen voor de host. Alleen actieve collecties worden
// getoond; de admin kan later nieuwe edities toevoegen zonder frontend-build.
router.get('/api/collecties', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.sleutel, c.naam, c.beschrijving, c.standaard_type,
                    COUNT(tc.titel_id)::int AS aantal
               FROM collecties c
               LEFT JOIN titel_collecties tc ON tc.collectie_id = c.id
              WHERE c.actief = true
              GROUP BY c.id
              ORDER BY c.naam ASC`,
        );
        res.json(rows);
    } catch (err) {
        logger.waarschuwing('Collecties ophalen mislukt.', { melding: err.message });
        res.json([]);
    }
});

// Publieke, niet-gevoelige huisstijl-instellingen. Het admin-wachtwoord en
// andere operationele waarden zitten nooit in deze response.
router.get('/api/instellingen', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT waarde FROM app_instellingen WHERE sleutel = 'thema' LIMIT 1`,
        );
        res.json(rows[0]?.waarde || {});
    } catch (err) {
        logger.waarschuwing('Publieke instellingen ophalen mislukt.', { melding: err.message });
        res.json({});
    }
});

// Live telling van titels/tracks die aan de filters voldoen.
router.get('/api/tracks/telling', async (req, res) => {
    const filter = {
        categorie: req.query.categorie,
        taal: req.query.taal,
        periode_start: Number(req.query.start),
        periode_eind: Number(req.query.eind),
        min_bekendheid: Number(req.query.bekendheid),
        zonder_genres: req.query.zonder
            ? String(req.query.zonder).split(',').filter(Boolean)
            : [],
        collecties: req.query.collectie && String(req.query.collectie) !== 'alles'
            ? String(req.query.collectie).split(',').filter(Boolean)
            : [],
        leeftijd_max: Number(req.query.leeftijd_max),
        alleen_nl_tv: req.query.alleen_nl_tv !== 'false',
    };
    const { where, params } = bouwFilter(filter);

    try {
        const { rows } = await pool.query(
            `SELECT COUNT(DISTINCT t.id)::int AS titels,
                    COUNT(tr.id)::int        AS tracks
               FROM titels t
               JOIN tracks tr ON tr.titel_id = t.id
                              AND tr.werkt = true
                              AND tr.preview_url IS NOT NULL
                              AND tr.preview_url <> ''
               ${where}`,
            params,
        );
        const titels = rows[0].titels;
        res.json({
            titels,
            tracks: rows[0].tracks,
            drempel: MIN_TITELS,
            genoeg: titels >= MIN_TITELS,
        });
    } catch (err) {
        logger.fout('Telling mislukt.', { melding: err.message });
        res.status(500).json({ fout: 'Kon de telling niet ophalen.' });
    }
});

// Presets ophalen (nieuwste eerst).
router.get('/api/presets', async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT id, naam, categorie, taal, periode_start, periode_eind,
                rondes, speeltijd, modus, min_bekendheid, zonder_genres,
                leeftijd_max, alleen_nl_tv, collecties,
                antwoord_modus,
                aangemaakt_op
           FROM presets
          ORDER BY aangemaakt_op DESC`,
    );
    res.json(rows);
});

// Preset opslaan.
router.post('/api/presets', async (req, res) => {
    const b = req.body || {};
    const naam = String(b.naam || '').trim().slice(0, 40);
    if (!naam) return res.status(400).json({ fout: 'Geef de preset een naam.' });

    try {
        const { rows } = await pool.query(
            `INSERT INTO presets
               (naam, categorie, taal, periode_start, periode_eind, rondes,
                speeltijd, modus, min_bekendheid, zonder_genres, leeftijd_max,
                alleen_nl_tv, antwoord_modus, collecties)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, naam, categorie, taal, periode_start, periode_eind,
                       rondes, speeltijd, modus, min_bekendheid, zonder_genres,
                       leeftijd_max, alleen_nl_tv, antwoord_modus, collecties, aangemaakt_op`,
            [
                naam,
                b.categorie || 'beide',
                b.taal || 'beide',
                Number.isFinite(b.periode_start) ? b.periode_start : 1930,
                Number.isFinite(b.periode_eind) ? b.periode_eind : 2100,
                Number.isFinite(b.rondes) ? b.rondes : 10,
                Number.isFinite(b.speeltijd) ? b.speeltijd : 0,
                b.modus === 'kenner' ? 'kenner' : 'snelste',
                Number.isFinite(b.min_bekendheid) ? b.min_bekendheid : 200,
                Array.isArray(b.zonder_genres) ? b.zonder_genres : [],
                Number.isFinite(b.leeftijd_max) ? b.leeftijd_max : 0,
                b.alleen_nl_tv !== false,
                b.antwoord_modus === 'meerkeuze' ? 'meerkeuze' : 'typen',
                Array.isArray(b.collecties) ? b.collecties : [],
            ],
        );
        res.json(rows[0]);
    } catch (err) {
        logger.fout('Preset opslaan mislukt.', { melding: err.message });
        res.status(500).json({ fout: 'Kon de preset niet opslaan.' });
    }
});

// Preset verwijderen.
router.delete('/api/presets/:id', async (req, res) => {
    await pool.query(`DELETE FROM presets WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// Ranglijst over alle gespeelde spellen, op spelersnaam.
router.get('/api/ranking', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT naam,
                    SUM(score)::int      AS totaal,
                    MAX(score)::int      AS beste,
                    COUNT(*)::int        AS spellen
               FROM spelers
              WHERE is_host = false OR score > 0
              GROUP BY naam
              HAVING SUM(score) > 0
              ORDER BY totaal DESC
              LIMIT 20`,
        );
        res.json(rows);
    } catch (err) {
        logger.waarschuwing('Ranking ophalen mislukt.', { melding: err.message });
        res.json([]);
    }
});

module.exports = router;
