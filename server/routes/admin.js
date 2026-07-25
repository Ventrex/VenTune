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
    // Gesorteerd zoals het spel ze kiest, zodat je bovenaan ziet wat er
    // daadwerkelijk gespeeld wordt.
    const { rows } = await pool.query(
        `SELECT * FROM tracks
          WHERE titel_id = $1
          ORDER BY werkt DESC, fout_aantal ASC, herkenbaarheid DESC, id DESC`,
        [req.params.id],
    );
    res.json(rows);
});

// Trackstatus aanpassen: goedkeuren, afkeuren, of als beste markeren.
router.patch('/api/admin/tracks/:id', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    const velden = [];
    const params = [req.params.id];

    if (typeof b.werkt === 'boolean') {
        params.push(b.werkt);
        velden.push(`werkt = $${params.length}`);
        if (b.werkt) velden.push('fout_aantal = 0');
    }
    if (typeof b.gecontroleerd === 'boolean') {
        params.push(b.gecontroleerd);
        velden.push(`gecontroleerd = $${params.length}`);
    }
    if (Number.isFinite(b.herkenbaarheid)) {
        params.push(Math.max(1, Math.min(5, b.herkenbaarheid)));
        velden.push(`herkenbaarheid = $${params.length}`);
    }
    if (Number.isFinite(b.start_seconde)) {
        params.push(Math.max(0, b.start_seconde));
        velden.push(`start_seconde = $${params.length}`);
    }
    if (velden.length === 0) {
        return res.status(400).json({ fout: 'Niets om bij te werken.' });
    }

    const { rows } = await pool.query(
        `UPDATE tracks SET ${velden.join(', ')} WHERE id = $1 RETURNING *`,
        params,
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Track niet gevonden.' });
    res.json(rows[0]);
});

// Vragen per titel bekijken en verwijderen.
router.get('/api/admin/titels/:id/vragen', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, soort, vraag, opties, correct_index, keer_gebruikt
           FROM vragen WHERE titel_id = $1 ORDER BY soort, id`,
        [req.params.id],
    );
    res.json(rows);
});

router.delete('/api/admin/vragen/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM vragen WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// Overzicht: hoe staat de vragenbank ervoor?
router.get('/api/admin/overzicht', vereisAdmin, async (_req, res) => {
    try {
        const d = await pool.query(
            `SELECT
               (SELECT count(*)::int FROM titels) AS titels,
               (SELECT count(*)::int FROM tracks) AS tracks,
               (SELECT count(*)::int FROM tracks WHERE werkt = false) AS afgekeurd,
               (SELECT count(*)::int FROM tracks WHERE gecontroleerd) AS gecontroleerd,
               (SELECT count(*)::int FROM titels t
                 WHERE EXISTS (SELECT 1 FROM tracks x
                                WHERE x.titel_id = t.id AND x.werkt)) AS speelbaar,
               (SELECT count(*)::int FROM vragen) AS vragen,
               (SELECT count(*)::int FROM meldingen WHERE afgehandeld = false) AS open_meldingen,
               (SELECT count(*)::int FROM zoek_cache) AS cache_regels`,
        );
        const perBron = await pool.query(
            `SELECT bron, count(*)::int AS n FROM tracks GROUP BY bron ORDER BY n DESC`,
        );
        res.json({ ...d.rows[0], per_bron: perBron.rows });
    } catch (err) {
        logger.waarschuwing('Overzicht mislukt.', { melding: err.message });
        res.json({});
    }
});

router.post('/api/admin/titels/:id/tracks', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.preview_url || !b.tracknaam) {
        return res.status(400).json({ fout: 'preview_url en tracknaam verplicht.' });
    }
    const geldigeBron = ['itunes', 'youtube', 'lokaal'].includes(b.bron)
        ? b.bron
        : 'itunes';
    const { rows } = await pool.query(
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             start_seconde, tracknaam, artiest, herkenbaarheid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
            req.params.id,
            geldigeBron,
            b.itunes_track_id ?? null,
            b.preview_url,
            Number.isFinite(b.start_seconde) ? b.start_seconde : 0,
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

// ---- Meldingen (fouten die spelers doorgaven) ----
router.get('/api/admin/meldingen', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT m.id, m.soort, m.toelichting, m.afgehandeld, m.aangemaakt_op,
                t.id AS titel_id, t.naam AS titel_naam,
                tr.id AS track_id, tr.bron, tr.preview_url, tr.tracknaam
           FROM meldingen m
           LEFT JOIN titels t  ON t.id = m.titel_id
           LEFT JOIN tracks tr ON tr.id = m.track_id
          WHERE m.afgehandeld = false
          ORDER BY m.aangemaakt_op DESC
          LIMIT 200`,
    );
    res.json(rows);
});

router.post('/api/admin/meldingen/:id/afgehandeld', vereisAdmin, async (req, res) => {
    await pool.query(`UPDATE meldingen SET afgehandeld = true WHERE id = $1`, [
        req.params.id,
    ]);
    res.json({ ok: true });
});

// ---- Seed importeren (iTunes) ----
// Draait in de achtergrond: ~290 titels duurt langer dan een tunnel/proxy
// een HTTP-verzoek openhoudt. De client vraagt de status apart op.
let seedStatus = {
    bezig: false,
    klaar: false,
    gestart_op: null,
    samenvatting: null,
    fout: null,
};

router.post('/api/admin/seed', vereisAdmin, (req, res) => {
    if (seedStatus.bezig) {
        return res.json({ gestart: false, bezig: true });
    }
    const force = !!(req.body && req.body.force);
    seedStatus = {
        bezig: true,
        klaar: false,
        gestart_op: new Date().toISOString(),
        samenvatting: null,
        fout: null,
    };
    logger.info('Seed-import gestart via admin (achtergrond).');

    // Bewust niet awaiten: meteen antwoorden, import loopt door.
    importeer({ force })
        .then((s) => {
            seedStatus = { ...seedStatus, bezig: false, klaar: true, samenvatting: s };
            logger.info('Seed-import klaar.', s);
        })
        .catch((err) => {
            seedStatus = { ...seedStatus, bezig: false, klaar: true, fout: err.message };
            logger.fout('Seed-import mislukt.', { melding: err.message });
        });

    res.json({ gestart: true });
});

router.get('/api/admin/seed/status', vereisAdmin, (_req, res) => {
    res.json(seedStatus);
});

module.exports = router;
