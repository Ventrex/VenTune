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
    const aantal = Math.min(100, Math.max(1, Number(req.body && req.body.aantal) || (100)));
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

// Lijst om te swipen. fase=blind → status 'nieuw' (ronde 1, zonder naam).
// fase=naam → status 'blind_nee' (ronde 2, met naam).
router.get('/api/admin/aanbevelingen', vereisAdmin, async (req, res) => {
    try {
        const soort = req.query.soort === 'kerst' ? 'kerst' : 'film_serie';
        const fase = req.query.fase === 'naam' ? 'blind_nee' : 'nieuw';
        const { rows } = await pool.query(
            `SELECT id, soort, titel, type, jaar, genres, tracknaam, artiest,
                    youtube_zoekterm, bekendheid, reden, voorbeeld_bron, status
             FROM aanbevelingen
             WHERE soort = $1 AND status = $2
             ORDER BY bekendheid DESC, aangemaakt_op
             LIMIT 100`, [soort, fase]);
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

function startDownload(id) {
    downloads.set(id, { status: 'bezig', error: null });
    media.verwerkGoed(id)
        .then((r) => downloads.set(id, { status: r.ok ? 'klaar' : 'fout', error: r.ok ? null : r.error }))
        .catch((e) => downloads.set(id, { status: 'fout', error: String(e.message) }));
}

// Swipe. In ronde 1 (blind) is keuze 'herkend' of 'niet'. In ronde 2 (naam)
// is keuze 'goed', 'fout' of 'onbekend'.
router.post('/api/admin/aanbevelingen/:id/swipe', vereisAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const keuze = req.body && req.body.keuze;
    const fase = req.body && req.body.fase === 'naam' ? 'naam' : 'blind';
    try {
        if (fase === 'blind') {
            // herkend → goed + download; niet → door naar ronde 2 (met naam).
            if (keuze === 'herkend') {
                const { rows } = await pool.query(
                    `UPDATE aanbevelingen SET status = 'goed', beoordeeld_op = now()
                     WHERE id = $1 AND status = 'nieuw' RETURNING id`, [id]);
                if (!rows[0]) return res.status(404).json({ fout: 'Niet gevonden of al beoordeeld.' });
                startDownload(id);
                return res.json({ ok: true, status: 'goed', download: true });
            }
            if (keuze === 'niet') {
                await pool.query(
                    `UPDATE aanbevelingen SET status = 'blind_nee'
                     WHERE id = $1 AND status = 'nieuw'`, [id]);
                return res.json({ ok: true, status: 'blind_nee' });
            }
            return res.status(400).json({ fout: 'Ongeldige keuze.' });
        }

        // fase === 'naam'
        if (keuze === 'goed') {
            const { rows } = await pool.query(
                `UPDATE aanbevelingen SET status = 'goed', beoordeeld_op = now()
                 WHERE id = $1 AND status = 'blind_nee' RETURNING id`, [id]);
            if (!rows[0]) return res.status(404).json({ fout: 'Niet gevonden of al beoordeeld.' });
            startDownload(id);
            return res.json({ ok: true, status: 'goed', download: true });
        }
        if (keuze === 'fout') {
            // Verkeerd nummer: AI moet later opnieuw zoeken. Bron wissen zodat
            // een herzoek een nieuw voorbeeld oplevert.
            await pool.query(
                `UPDATE aanbevelingen SET status = 'fout', fout_aantal = fout_aantal + 1,
                        voorbeeld_bron = NULL, beoordeeld_op = now()
                 WHERE id = $1 AND status = 'blind_nee'`, [id]);
            return res.json({ ok: true, status: 'fout' });
        }
        if (keuze === 'onbekend') {
            await pool.query(
                `UPDATE aanbevelingen SET status = 'review', beoordeeld_op = now()
                 WHERE id = $1 AND status = 'blind_nee'`, [id]);
            return res.json({ ok: true, status: 'review' });
        }
        return res.status(400).json({ fout: 'Ongeldige keuze.' });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

/** Status van de download na een 'goed'-swipe. */
router.get('/api/admin/aanbevelingen/:id/download-status', vereisAdmin, (req, res) => {
    const d = downloads.get(Number(req.params.id));
    res.json(d || { status: 'onbekend', error: null });
});

// Foute nummers opnieuw laten zoeken door ChatGPT (achtergrond).
let herzoekBezig = false;
router.post('/api/admin/aanbevelingen/herzoek', vereisAdmin, (req, res) => {
    if (herzoekBezig) return res.status(409).json({ fout: 'Herzoeken loopt al.' });
    herzoekBezig = true;
    res.json({ gestart: true });
    aanbevelingen.herzoekFout({ limiet: 15 })
        .catch((e) => logger.fout('Herzoek mislukt', { melding: e.message }))
        .finally(() => { herzoekBezig = false; });
});

// =====================================================================
// Publieke review-link: vrienden beluisteren de 'onbekend'-nummers blind
// en stemmen of ze het herkennen. Genoeg "herkend" → automatisch goed +
// download. Geen admin-login; wel per-apparaat één stem per nummer.
// =====================================================================

const REVIEW_DREMPEL = 2;   // minstens 2 meer "herkend" dan "niet"
const REVIEW_MIN_STEMMEN = 3;

/** Volgende te beoordelen nummer voor een stemmer (zonder titelinfo). */
router.get('/api/review/volgende', async (req, res) => {
    try {
        const stemmer = String(req.query.stemmer || '').slice(0, 64);
        const { rows } = await pool.query(
            `SELECT a.id, a.voorbeeld_bron, a.youtube_zoekterm, a.tracknaam, a.artiest
             FROM aanbevelingen a
             WHERE a.status = 'review'
               AND ($1 = '' OR NOT EXISTS (
                   SELECT 1 FROM aanbeveling_stemmen s
                   WHERE s.aanbeveling_id = a.id AND s.stemmer = $1))
             ORDER BY random() LIMIT 1`, [stemmer]);
        const a = rows[0];
        if (!a) return res.json({ klaar: true });

        // Voorbeeld-bron bepalen (zoeken als nog niet bekend) — zonder titel terug te geven.
        let videoId = a.voorbeeld_bron;
        if (!videoId) {
            const v = await media.zoekVoorbeeld(a);
            if (v) {
                videoId = v.videoId;
                await pool.query('UPDATE aanbevelingen SET voorbeeld_bron = $2 WHERE id = $1', [a.id, videoId]);
            }
        }
        res.json({ id: a.id, videoId: videoId || null });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

/** Stem uitbrengen op een review-nummer. */
router.post('/api/review/:id/stem', async (req, res) => {
    const id = Number(req.params.id);
    const stemmer = String(req.body?.stemmer || '').slice(0, 64);
    const herkend = req.body?.herkend === true;
    if (!stemmer) return res.status(400).json({ fout: 'Geen stemmer-id.' });
    try {
        await pool.query(
            `INSERT INTO aanbeveling_stemmen (aanbeveling_id, stemmer, herkend)
             VALUES ($1, $2, $3)
             ON CONFLICT (aanbeveling_id, stemmer) DO UPDATE SET herkend = EXCLUDED.herkend`,
            [id, stemmer, herkend]);

        // Telling: genoeg herkenning → goedkeuren en downloaden.
        const { rows } = await pool.query(
            `SELECT count(*) FILTER (WHERE herkend) AS ja,
                    count(*) FILTER (WHERE NOT herkend) AS nee
             FROM aanbeveling_stemmen WHERE aanbeveling_id = $1`, [id]);
        const ja = Number(rows[0].ja), nee = Number(rows[0].nee);
        if (ja + nee >= REVIEW_MIN_STEMMEN && ja - nee >= REVIEW_DREMPEL) {
            const { rows: upd } = await pool.query(
                `UPDATE aanbevelingen SET status = 'goed', beoordeeld_op = now()
                 WHERE id = $1 AND status = 'review' RETURNING id`, [id]);
            if (upd[0]) startDownload(id);
        }
        res.json({ ok: true, ja, nee });
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

module.exports = router;
