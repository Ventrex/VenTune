// =====================================================================
// Admin-routes voor aanbevelingen (ChatGPT/Codex) en het Tinder-swipen.
//
//   POST /api/admin/aanbevelingen/genereer   { soort, aantal, taal }
//   GET  /api/admin/aanbevelingen/status     -> ChatGPT-koppeling + aantallen
//   GET  /api/admin/aanbevelingen            -> kandidaten om te swipen
//   POST /api/admin/aanbevelingen/:id/swipe  { keuze: goed|fout|weet_niet }
//
// 'genereer' draait op de achtergrond zodat het verzoek niet blokkeert;
// de voortgang is op te vragen via /status.
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const codex = require('../lib/codex');
const aanbevelingen = require('../lib/aanbevelingen');
const media = require('../lib/aanbeveling-media');
const { vereisAdmin } = require('./admin');
const logger = require('../lib/logger');

const router = express.Router();

// Achtergrondstatus van de laatste generatie-run.
let run = { bezig: false, soort: null, gestart: null, klaar: null, resultaat: null, fout: null };

router.get('/api/admin/aanbevelingen/status', vereisAdmin, async (_req, res) => {
    try {
        const login = await codex.loginStatus();
        const tel = await pool.query(
            `SELECT soort, status, count(*)::int AS n
             FROM aanbevelingen GROUP BY soort, status`);
        const aantallen = {};
        for (const r of tel.rows) {
            aantallen[r.soort] = aantallen[r.soort] || {};
            aantallen[r.soort][r.status] = r.n;
        }
        res.json({
            chatgpt: { gekoppeld: login.loggedIn, toelichting: login.text },
            run,
            aantallen,
        });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

// --- Simpele database-samenvatting voor het beheer ---
router.get('/api/admin/db-overzicht', vereisAdmin, async (_req, res) => {
    try {
        const q = async (sql) => {
            try { return Number((await pool.query(sql)).rows[0].n) || 0; } catch { return 0; }
        };
        res.json({
            titels: await q('SELECT count(*) n FROM titels'),
            nummers: await q('SELECT count(*) n FROM tracks'),
            speelbaar: await q(`SELECT count(*) n FROM tracks WHERE werkt = true AND download_status = 'available'`),
            downloadfouten: await q(`SELECT count(*) n FROM tracks WHERE download_status = 'error'`),
            te_swipen: await q(`SELECT count(*) n FROM aanbevelingen WHERE status = 'nieuw'`),
        });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

// --- ChatGPT koppelen via de site (device-code login) ---

router.post('/api/admin/aanbevelingen/login/start', vereisAdmin, (req, res) => {
    const s = codex.startLogin();
    res.json(codex.loginSessieStatus(s));
});

router.get('/api/admin/aanbevelingen/login/status', vereisAdmin, (req, res) => {
    res.json(codex.loginSessieStatus());
});

router.post('/api/admin/aanbevelingen/login/uit', vereisAdmin, (req, res) => {
    res.json(codex.logUit());
});

router.post('/api/admin/aanbevelingen/genereer', vereisAdmin, async (req, res) => {
    if (run.bezig) return res.status(409).json({ fout: 'Er loopt al een generatie.' });
    const soort = req.body && req.body.soort === 'kerst' ? 'kerst' : 'film_serie';
    const aantal = Math.min(40, Math.max(1, Number(req.body && req.body.aantal) || 15));
    const taal = (req.body && req.body.taal) || 'beide';

    run = { bezig: true, soort, gestart: new Date().toISOString(), klaar: null, resultaat: null, fout: null };
    res.json({ gestart: true, soort, aantal });

    // Achtergrond.
    aanbevelingen.genereer({ soort, aantal, taal })
        .then((r) => {
            run = { ...run, bezig: false, klaar: new Date().toISOString(), resultaat: r.ok ? r : null, fout: r.ok ? null : r.error };
        })
        .catch((err) => {
            logger.fout('Aanbevelingen genereren mislukt', { melding: err.message });
            run = { ...run, bezig: false, klaar: new Date().toISOString(), fout: err.message };
        });
});

router.get('/api/admin/aanbevelingen', vereisAdmin, async (req, res) => {
    try {
        const soort = req.query.soort === 'kerst' ? 'kerst' : 'film_serie';
        const { rows } = await pool.query(
            `SELECT id, soort, titel, type, jaar, genres, tracknaam, artiest,
                    youtube_zoekterm, bekendheid, reden, voorbeeld_bron, status
             FROM aanbevelingen
             WHERE soort = $1 AND status = 'nieuw'
             ORDER BY bekendheid DESC, aangemaakt_op
             LIMIT 100`, [soort]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

/** Voorbeeld (YouTube-video-id) voor een kandidaat, om te beluisteren. */
router.get('/api/admin/aanbevelingen/:id/voorbeeld', vereisAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM aanbevelingen WHERE id = $1', [Number(req.params.id)]);
        const a = rows[0];
        if (!a) return res.status(404).json({ fout: 'Niet gevonden.' });
        if (a.voorbeeld_bron) return res.json({ videoId: a.voorbeeld_bron });
        const v = await media.zoekVoorbeeld(a);
        if (!v) return res.json({ videoId: null });
        // Bewaar zodat we niet opnieuw hoeven te zoeken.
        await pool.query('UPDATE aanbevelingen SET voorbeeld_bron = $2 WHERE id = $1', [a.id, v.videoId]);
        res.json({ videoId: v.videoId, titel: v.titel });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

// Downloads die op de achtergrond lopen na een 'goed'-swipe.
const downloads = new Map(); // id -> { status, error }

router.post('/api/admin/aanbevelingen/:id/swipe', vereisAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const keuze = req.body && req.body.keuze;
    const geldig = { goed: 'goed', fout: 'fout', weet_niet: 'weet_niet' };
    if (!geldig[keuze]) return res.status(400).json({ fout: 'Ongeldige keuze.' });
    try {
        const { rows } = await pool.query(
            `UPDATE aanbevelingen SET status = $2, beoordeeld_op = now()
             WHERE id = $1 AND status = 'nieuw' RETURNING id`,
            [id, geldig[keuze]]);
        if (!rows[0]) return res.status(404).json({ fout: 'Niet gevonden of al beoordeeld.' });

        // Bij 'goed': op de achtergrond downloaden en speelbaar maken.
        if (keuze === 'goed') {
            downloads.set(id, { status: 'bezig', error: null });
            media.verwerkGoed(id)
                .then((r) => downloads.set(id, { status: r.ok ? 'klaar' : 'fout', error: r.ok ? null : r.error }))
                .catch((e) => downloads.set(id, { status: 'fout', error: String(e.message) }));
        }
        res.json({ ok: true, status: geldig[keuze], download: keuze === 'goed' });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

/** Status van de download na een 'goed'-swipe. */
router.get('/api/admin/aanbevelingen/:id/download-status', vereisAdmin, (req, res) => {
    const d = downloads.get(Number(req.params.id));
    res.json(d || { status: 'onbekend', error: null });
});

module.exports = router;
