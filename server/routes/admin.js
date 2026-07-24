// =====================================================================
// Admin-portal (/admin). Wachtwoord uit ADMIN_PASSWORD.
//
//   POST   /api/admin/login            { wachtwoord }
//   POST   /api/admin/logout
//   GET    /api/admin/sessie
//   GET    /api/admin/titels?zoek=
//   POST   /api/admin/titels
//   PUT    /api/admin/titels/:id
//   DELETE /api/admin/titels/:id
//   GET    /api/admin/titels/:id/tracks
//   POST   /api/admin/titels/:id/tracks
//   DELETE /api/admin/tracks/:id
//   POST   /api/admin/seed            (iTunes-import van de startseed)
// =====================================================================

const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const cookies = require('../lib/cookies');
const logger = require('../lib/logger');
const { importeer } = require('../../seed/import');

const router = express.Router();

const COOKIE = 'ventune_admin';
const HTTPS = (process.env.APP_URL || '').startsWith('https');

// Vast token afgeleid van het wachtwoord + geheim. Verandert het wachtwoord,
// dan zijn oude cookies ongeldig.
function adminToken() {
    const basis = (process.env.SESSION_SECRET || '') + (process.env.ADMIN_PASSWORD || '');
    return crypto.createHash('sha256').update(basis).digest('hex');
}

function isIngelogd(req) {
    const jar = cookies.parse(req.headers.cookie);
    return (
        !!process.env.ADMIN_PASSWORD &&
        jar[COOKIE] &&
        // Constante-tijd vergelijking.
        crypto.timingSafeEqual(
            Buffer.from(jar[COOKIE]),
            Buffer.from(adminToken()),
        )
    );
}

function vereisAdmin(req, res, next) {
    try {
        if (isIngelogd(req)) return next();
    } catch {
        /* lengteverschil in timingSafeEqual → niet ingelogd */
    }
    res.status(401).json({ fout: 'Niet ingelogd.' });
}

// ---- Auth ----
router.post('/api/admin/login', (req, res) => {
    const wachtwoord = req.body && req.body.wachtwoord;
    if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ fout: 'ADMIN_PASSWORD niet ingesteld.' });
    }
    if (wachtwoord !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ fout: 'Onjuist wachtwoord.' });
    }
    res.setHeader(
        'Set-Cookie',
        cookies.serialiseer(COOKIE, adminToken(), {
            httpOnly: true,
            secure: HTTPS,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60,
        }),
    );
    res.json({ ok: true });
});

router.post('/api/admin/logout', (req, res) => {
    res.setHeader(
        'Set-Cookie',
        cookies.serialiseer(COOKIE, '', {
            httpOnly: true,
            secure: HTTPS,
            sameSite: 'Lax',
            maxAge: 0,
        }),
    );
    res.json({ ok: true });
});

router.get('/api/admin/sessie', (req, res) => {
    res.json({ ingelogd: isIngelogd(req) });
});

// ---- Titels ----
router.get('/api/admin/titels', vereisAdmin, async (req, res) => {
    const zoek = String(req.query.zoek || '').trim();
    const params = [];
    let where = '';
    if (zoek) {
        params.push(`%${zoek}%`);
        where = `WHERE t.naam ILIKE $1`;
    }
    const { rows } = await pool.query(
        `SELECT t.*, COUNT(tr.id)::int AS aantal_tracks
           FROM titels t
           LEFT JOIN tracks tr ON tr.titel_id = t.id
           ${where}
          GROUP BY t.id
          ORDER BY t.naam ASC
          LIMIT 300`,
        params,
    );
    res.json(rows);
});

router.post('/api/admin/titels', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.naam || !b.type || !b.taal) {
        return res.status(400).json({ fout: 'Naam, type en taal zijn verplicht.' });
    }
    const { rows } = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, land, genres, tmdb_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
            b.naam,
            b.aliassen || [],
            b.type,
            b.taal,
            b.jaar ?? null,
            b.land || null,
            b.genres || [],
            b.tmdb_id ?? null,
        ],
    );
    res.json(rows[0]);
});

router.put('/api/admin/titels/:id', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    const { rows } = await pool.query(
        `UPDATE titels SET naam = $2, aliassen = $3, type = $4, taal = $5,
                jaar = $6, land = $7, genres = $8, tmdb_id = $9
          WHERE id = $1 RETURNING *`,
        [
            req.params.id,
            b.naam,
            b.aliassen || [],
            b.type,
            b.taal,
            b.jaar ?? null,
            b.land || null,
            b.genres || [],
            b.tmdb_id ?? null,
        ],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    res.json(rows[0]);
});

router.delete('/api/admin/titels/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM titels WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// ---- Tracks ----
router.get('/api/admin/titels/:id/tracks', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT * FROM tracks WHERE titel_id = $1 ORDER BY id ASC`,
        [req.params.id],
    );
    res.json(rows);
});

router.post('/api/admin/titels/:id/tracks', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.preview_url || !b.tracknaam) {
        return res.status(400).json({ fout: 'preview_url en tracknaam verplicht.' });
    }
    const { rows } = await pool.query(
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             tracknaam, artiest, herkenbaarheid)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
            req.params.id,
            b.bron === 'lokaal' ? 'lokaal' : 'itunes',
            b.itunes_track_id ?? null,
            b.preview_url,
            b.tracknaam,
            b.artiest || '',
            Number.isFinite(b.herkenbaarheid) ? b.herkenbaarheid : 3,
        ],
    );
    res.json(rows[0]);
});

router.delete('/api/admin/tracks/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM tracks WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// ---- Seed importeren (iTunes) ----
router.post('/api/admin/seed', vereisAdmin, async (req, res) => {
    try {
        const force = !!(req.body && req.body.force);
        logger.info('Seed-import gestart via admin.');
        const samenvatting = await importeer({ force });
        logger.info('Seed-import klaar.', samenvatting);
        res.json(samenvatting);
    } catch (err) {
        logger.fout('Seed-import mislukt.', { melding: err.message });
        res.status(500).json({ fout: err.message });
    }
});

module.exports = router;
