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
//   POST   /api/admin/seed            (YouTube-import, iTunes als fallback)
//   POST   /api/admin/tmdb/import      (gerichte film/serie-import)
//   POST   /api/admin/collecties/import (collectie vullen + vooraf downloaden)
//   POST   /api/admin/downloads/start  (URL-check + mp3 bulkdownload)
//   POST   /api/admin/titels/:id/tracks/upload
//   GET    /api/admin/ontbrekende-tracks
//   POST/PATCH /api/admin/gebruikers  (hostaccounts)
// =====================================================================

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const cookies = require('../lib/cookies');
const logger = require('../lib/logger');
const { importeer } = require('../../seed/import');
const { importeerPlaylists } = require('../../seed/playlist-import');
const { importeerTmdb } = require('../../seed/tmdb-import');
const { importeerVragen } = require('../../seed/vragen-import');
const { pastBijTitel } = require('../lib/trackcheck');
const ytzoek = require('../lib/ytzoek');
const tmdb = require('../lib/tmdb');
const { downloadTrack, controleerTrackUrl } = require('../../seed/download-track');
const {
    hashWachtwoord,
    valideerWachtwoord,
    valideerGebruikersnaam,
    valideerDisplayNaam,
} = require('../lib/auth');

const router = express.Router();

const COOKIE = 'ventune_admin';
const HTTPS = (process.env.APP_URL || '').startsWith('https');
const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(MEDIA_DIR, 'uploads');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

function normaliseerCollecties(waarden) {
    const lijst = Array.isArray(waarden) ? waarden : [];
    return [...new Set(lijst
        .map((waarde) => String(waarde).trim().toLowerCase())
        .filter((waarde) => /^[a-z0-9][a-z0-9-]*$/.test(waarde)))];
}

async function bewaarTitelCollecties(titelId, waarden) {
    const sleutels = normaliseerCollecties(waarden);
    await pool.query(`DELETE FROM titel_collecties WHERE titel_id = $1`, [titelId]);
    for (const sleutel of sleutels) {
        const { rows } = await pool.query(
            `INSERT INTO collecties (sleutel, naam, standaard_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (sleutel) DO UPDATE SET naam = collecties.naam
             RETURNING id`,
            [sleutel, sleutel.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
                ['smartlappen', 'rock'].includes(sleutel) ? 'muziek' : 'beide'],
        );
        await pool.query(
            `INSERT INTO titel_collecties (titel_id, collectie_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [titelId, rows[0].id],
        );
    }
}

function uploadAudio(req, res, next) {
    upload.single('bestand')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ fout: 'Audiobestand is groter dan 50 MB.' });
        }
        return res.status(400).json({ fout: `Upload mislukt: ${err.message}` });
    });
}

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

// ---- Spelcollecties ----
router.get('/api/admin/collecties', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT c.id, c.sleutel, c.naam, c.beschrijving, c.standaard_type,
                c.actief, c.toevoeg_reden, COUNT(tc.titel_id)::int AS aantal
           FROM collecties c
           LEFT JOIN titel_collecties tc ON tc.collectie_id = c.id
          GROUP BY c.id
          ORDER BY c.naam ASC`,
    );
    res.json(rows);
});

router.post('/api/admin/collecties', vereisAdmin, async (req, res) => {
    const sleutel = String(req.body?.sleutel || '').trim().toLowerCase();
    const naam = String(req.body?.naam || '').trim().slice(0, 80);
    const type = ['film', 'serie', 'muziek', 'beide', 'alles'].includes(req.body?.standaard_type)
        ? req.body.standaard_type : 'beide';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(sleutel) || !naam) {
        return res.status(400).json({ fout: 'Gebruik een naam en sleutel zoals mijn-editie.' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO collecties (sleutel, naam, beschrijving, standaard_type, toevoeg_reden)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [sleutel, naam, String(req.body?.beschrijving || '').slice(0, 300), type,
                String(req.body?.toevoeg_reden || 'Handmatig toegevoegd door de admin.').slice(0, 500)],
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ fout: 'Deze collectie bestaat al.' });
        res.status(400).json({ fout: err.message });
    }
});

router.patch('/api/admin/collecties/:id', vereisAdmin, async (req, res) => {
    const velden = [];
    const params = [req.params.id];
    if (req.body?.naam != null) { params.push(String(req.body.naam).trim().slice(0, 80)); velden.push(`naam = $${params.length}`); }
    if (req.body?.beschrijving != null) { params.push(String(req.body.beschrijving).slice(0, 300)); velden.push(`beschrijving = $${params.length}`); }
    if (req.body?.toevoeg_reden != null) { params.push(String(req.body.toevoeg_reden).slice(0, 500)); velden.push(`toevoeg_reden = $${params.length}`); }
    if (typeof req.body?.actief === 'boolean') { params.push(req.body.actief); velden.push(`actief = $${params.length}`); }
    if (['film', 'serie', 'muziek', 'beide', 'alles'].includes(req.body?.standaard_type)) {
        params.push(req.body.standaard_type); velden.push(`standaard_type = $${params.length}`);
    }
    if (!velden.length) return res.status(400).json({ fout: 'Niets om bij te werken.' });
    const { rows } = await pool.query(
        `UPDATE collecties SET ${velden.join(', ')} WHERE id = $1 RETURNING *`, params,
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Collectie niet gevonden.' });
    res.json(rows[0]);
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
        `SELECT t.*, COUNT(tr.id)::int AS aantal_tracks,
                COALESCE(array_agg(DISTINCT c.sleutel) FILTER (WHERE c.sleutel IS NOT NULL), '{}') AS collecties
           FROM titels t
           LEFT JOIN tracks tr ON tr.titel_id = t.id
           LEFT JOIN titel_collecties tc ON tc.titel_id = t.id
           LEFT JOIN collecties c ON c.id = tc.collectie_id
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
    if (!b.naam || !['film', 'serie', 'muziek'].includes(b.type) || !['nl', 'en'].includes(b.taal)) {
        return res.status(400).json({ fout: 'Naam, type (film/serie/muziek) en taal zijn verplicht.' });
    }
    const { rows } = await pool.query(
         `INSERT INTO titels
             (naam, aliassen, type, taal, jaar, land, genres, tmdb_id, hoofdrollen,
              speelplek, toevoeg_reden, nl_tv_bekend, curatie_status, leeftijdsgrens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
            b.naam,
            b.aliassen || [],
            b.type,
            b.taal,
            b.jaar ?? null,
            b.land || null,
            b.genres || [],
            b.tmdb_id ?? null,
            b.hoofdrollen || [],
            b.speelplek || null,
            b.toevoeg_reden || 'Handmatig toegevoegd door de admin.',
            b.nl_tv_bekend !== false,
            ['goedgekeurd', 'te_beoordelen', 'uitgesloten'].includes(b.curatie_status)
                ? b.curatie_status : 'goedgekeurd',
            [0, 6, 10, 12, 16, 18].includes(Number(b.leeftijdsgrens))
                ? Number(b.leeftijdsgrens) : 16,
        ],
    );
    if (b.collecties !== undefined) await bewaarTitelCollecties(rows[0].id, b.collecties);
    res.json(rows[0]);
});

router.put('/api/admin/titels/:id', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.naam || !['film', 'serie', 'muziek'].includes(b.type) || !['nl', 'en'].includes(b.taal)) {
        return res.status(400).json({ fout: 'Naam, type (film/serie/muziek) en taal zijn verplicht.' });
    }
    const { rows } = await pool.query(
        `UPDATE titels SET naam = $2, aliassen = $3, type = $4, taal = $5,
                jaar = $6, land = $7, genres = $8, tmdb_id = $9,
                hoofdrollen = $10, speelplek = $11, toevoeg_reden = $12,
                nl_tv_bekend = $13, curatie_status = $14, leeftijdsgrens = $15
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
            b.hoofdrollen || [],
            b.speelplek || null,
            b.toevoeg_reden || 'Handmatig bijgewerkt door de admin.',
            b.nl_tv_bekend !== false,
            ['goedgekeurd', 'te_beoordelen', 'uitgesloten'].includes(b.curatie_status)
                ? b.curatie_status : 'goedgekeurd',
            [0, 6, 10, 12, 16, 18].includes(Number(b.leeftijdsgrens))
                ? Number(b.leeftijdsgrens) : 16,
        ],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    if (b.collecties !== undefined) await bewaarTitelCollecties(rows[0].id, b.collecties);
    res.json(rows[0]);
});

router.delete('/api/admin/titels/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM titels WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

router.put('/api/admin/titels/:id/collecties', vereisAdmin, async (req, res) => {
    const titel = await pool.query(`SELECT id FROM titels WHERE id = $1`, [req.params.id]);
    if (!titel.rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    await bewaarTitelCollecties(req.params.id, req.body?.collecties);
    const { rows } = await pool.query(
        `SELECT c.sleutel, c.naam
           FROM titel_collecties tc JOIN collecties c ON c.id = tc.collectie_id
          WHERE tc.titel_id = $1 ORDER BY c.naam`,
        [req.params.id],
    );
    res.json({ collecties: rows });
});

// ---- Tracks ----
router.get('/api/admin/titels/:id/tracks', vereisAdmin, async (req, res) => {
    // Gesorteerd zoals het spel ze kiest, zodat je bovenaan ziet wat er
    // daadwerkelijk gespeeld wordt.
    const { rows } = await pool.query(
        `SELECT * FROM tracks
          WHERE titel_id = $1
          ORDER BY werkt DESC, fout_aantal ASC, keer_gespeeld ASC,
                   laatst_gespeeld ASC NULLS FIRST, herkenbaarheid DESC, id DESC`,
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
    if (b.gecontroleerd === true) {
        velden.push('verificatie_score = 1');
        velden.push("verificatie_reden = 'handmatig goedgekeurd door admin'");
        velden.push('laatst_gecontroleerd_op = now()');
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
                                WHERE x.titel_id = t.id AND x.werkt
                                  AND x.preview_url IS NOT NULL AND x.preview_url <> '')) AS speelbaar,
               (SELECT count(*)::int FROM vragen) AS vragen,
               (SELECT count(*)::int FROM meldingen WHERE afgehandeld = false) AS open_meldingen,
               (SELECT count(*)::int FROM titels t
                 WHERE NOT EXISTS (SELECT 1 FROM tracks x
                                    WHERE x.titel_id = t.id AND x.werkt
                                      AND x.preview_url IS NOT NULL AND x.preview_url <> ''))
                 AS ontbrekende_tracks,
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

// ---- Applicatie-instellingen / uiterlijk ----
const THEMA_SLEUTELS = [
    'appNaam', 'ondertitel', 'logoPad', 'achtergrond', 'oppervlak', 'rand',
    'accent', 'accentDonker', 'tekst', 'tekstDim', 'lettertype',
];
const VEILIGE_LETTERTYPEN = new Set([
    'system-ui', 'Inter', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'monospace',
]);

function schoonThema(input = {}, oud = {}) {
    const uitkomst = { ...oud };
    for (const sleutel of THEMA_SLEUTELS) {
        if (input[sleutel] === undefined) continue;
        const waarde = String(input[sleutel]).trim().slice(0, 120);
        if (['appNaam', 'ondertitel', 'logoPad'].includes(sleutel)) {
            uitkomst[sleutel] = waarde;
        } else if (sleutel === 'lettertype') {
            if (VEILIGE_LETTERTYPEN.has(waarde)) uitkomst[sleutel] = waarde;
        } else if (/^#[0-9a-f]{6}$/i.test(waarde)) {
            uitkomst[sleutel] = waarde;
        }
    }
    return uitkomst;
}

router.get('/api/admin/instellingen', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT waarde FROM app_instellingen WHERE sleutel = 'thema' LIMIT 1`,
    );
    res.json({ thema: rows[0]?.waarde || {} });
});

router.patch('/api/admin/instellingen', vereisAdmin, async (req, res) => {
    const bestaand = await pool.query(
        `SELECT waarde FROM app_instellingen WHERE sleutel = 'thema' LIMIT 1`,
    );
    const thema = schoonThema(req.body?.thema || {}, bestaand.rows[0]?.waarde || {});
    await pool.query(
        `INSERT INTO app_instellingen (sleutel, waarde, bijgewerkt_op)
         VALUES ('thema', $1::jsonb, now())
         ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt_op = now()`,
        [JSON.stringify(thema)],
    );
    res.json({ thema });
});

router.post('/api/admin/instellingen/logo', vereisAdmin, upload.single('logo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ fout: 'Kies een logo-afbeelding.' });
    const mime = String(req.file.mimetype || '').toLowerCase();
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const toegestaan = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
    if (!toegestaan.has(mime) || !['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) {
        return res.status(415).json({ fout: 'Gebruik een PNG, JPG, WebP of SVG-logo.' });
    }
    const naam = `logo-${crypto.randomUUID()}${ext}`;
    const absoluut = path.join(UPLOAD_DIR, naam);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(absoluut, req.file.buffer, { flag: 'wx' });
    const pad = `/media/uploads/${naam}`;
    const bestaand = await pool.query(
        `SELECT waarde FROM app_instellingen WHERE sleutel = 'thema' LIMIT 1`,
    );
    const thema = schoonThema({ logoPad: pad }, bestaand.rows[0]?.waarde || {});
    await pool.query(
        `INSERT INTO app_instellingen (sleutel, waarde, bijgewerkt_op)
         VALUES ('thema', $1::jsonb, now())
         ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt_op = now()`,
        [JSON.stringify(thema)],
    );
    res.status(201).json({ thema, pad });
});

// ---- Database-overzicht en veilige opschoning ----
router.get('/api/admin/database', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT relname AS tabel, n_live_tup::bigint AS schatting
           FROM pg_stat_user_tables
          WHERE schemaname = 'public'
          ORDER BY relname`,
    );
    res.json({ tabellen: rows, database: process.env.POSTGRES_DB || 'VenTune PostgreSQL' });
});

router.post('/api/admin/database/opschonen', vereisAdmin, async (req, res) => {
    const actie = String(req.body?.actie || '');
    const acties = {
        zoek_cache: `DELETE FROM zoek_cache`,
        afgehandelde_meldingen: `DELETE FROM meldingen WHERE afgehandeld = true`,
        spelgeschiedenis: `DELETE FROM lobbies WHERE status = 'afgelopen'`,
        afgekeurde_tracks: `DELETE FROM tracks WHERE werkt = false`,
    };
    if (!acties[actie]) {
        return res.status(400).json({ fout: 'Onbekende opschoonactie.' });
    }
    const resultaat = await pool.query(acties[actie]);
    res.json({ ok: true, actie, verwijderd: resultaat.rowCount });
});

router.get('/api/admin/database/export', vereisAdmin, async (_req, res) => {
    const tabellen = {
        titels: 'SELECT * FROM titels ORDER BY id',
        tracks: 'SELECT * FROM tracks ORDER BY id',
        collecties: 'SELECT * FROM collecties ORDER BY id',
        titel_collecties: 'SELECT * FROM titel_collecties ORDER BY titel_id, collectie_id',
        meldingen: 'SELECT * FROM meldingen ORDER BY id',
        presets: 'SELECT * FROM presets ORDER BY id',
        gebruikers: `SELECT id, gebruikersnaam, display_naam, actief, aangemaakt_op, laatst_ingelogd
                       FROM gebruikers ORDER BY gebruikersnaam_norm`,
        instellingen: 'SELECT * FROM app_instellingen ORDER BY sleutel',
    };
    const exportData = {};
    for (const [naam, query] of Object.entries(tabellen)) {
        exportData[naam] = (await pool.query(query)).rows;
    }
    res.setHeader('Content-Disposition', 'attachment; filename="ventune-database-export.json"');
    res.json({ geëxporteerd_op: new Date().toISOString(), ...exportData });
});

// Titels zonder speelbare track. Dit is de vaste werklijst voor handmatige
// audio-upload of een gecontroleerde nieuwe YouTube-koppeling.
router.get('/api/admin/ontbrekende-tracks', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT t.id, t.naam, t.type, t.taal, t.jaar, t.land, t.genres,
                t.tmdb_id, t.hoofdrollen, t.speelplek,
                EXISTS (SELECT 1 FROM meldingen m
                         WHERE m.titel_id = t.id
                           AND m.soort = 'geen_track'
                           AND m.afgehandeld = false) AS gemeld
           FROM titels t
          WHERE NOT EXISTS (SELECT 1 FROM tracks tr
                             WHERE tr.titel_id = t.id
                               AND tr.werkt = true
                               AND tr.preview_url IS NOT NULL
                               AND tr.preview_url <> '')
          ORDER BY t.naam ASC
          LIMIT 500`,
    );
    res.json(rows);
});

// Hostaccounts beheren zonder het admin-wachtwoord in de database te zetten.
// Wachtwoorden worden nooit teruggestuurd; een reset maakt bestaande
// hostsessies direct ongeldig.
router.post('/api/admin/gebruikers', vereisAdmin, async (req, res) => {
    try {
        const gebruikersnaam = valideerGebruikersnaam(req.body?.gebruikersnaam);
        const wachtwoord = valideerWachtwoord(req.body?.wachtwoord);
        const displayNaam = valideerDisplayNaam(req.body?.display_naam, gebruikersnaam);
        const hash = await hashWachtwoord(wachtwoord);
        const { rows } = await pool.query(
            `INSERT INTO gebruikers
                (gebruikersnaam, gebruikersnaam_norm, display_naam, wachtwoord_hash)
             VALUES ($1, $1, $2, $3)
             RETURNING id, gebruikersnaam, display_naam, actief`,
            [gebruikersnaam, displayNaam, hash],
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ fout: 'Deze gebruikersnaam bestaat al.' });
        res.status(400).json({ fout: err.message || 'Gebruiker aanmaken mislukt.' });
    }
});

router.get('/api/admin/gebruikers', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT id, gebruikersnaam, display_naam, actief, aangemaakt_op, laatst_ingelogd
           FROM gebruikers
          ORDER BY gebruikersnaam_norm ASC`,
    );
    res.json(rows);
});

router.get('/api/admin/spelers', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT s.naam, COUNT(*)::int AS spellen,
                MAX(s.aangemaakt_op) AS laatst_gezien,
                BOOL_OR(s.is_host) AS ooit_host
           FROM spelers s
          GROUP BY s.naam
          ORDER BY laatst_gezien DESC
          LIMIT 500`,
    );
    res.json(rows);
});

router.patch('/api/admin/gebruikers/:id', vereisAdmin, async (req, res) => {
    try {
        const velden = [];
        const params = [req.params.id];
        if (typeof req.body?.actief === 'boolean') {
            params.push(req.body.actief);
            velden.push(`actief = $${params.length}`);
        }
        if (req.body?.gebruikersnaam != null) {
            const gebruikersnaam = valideerGebruikersnaam(req.body.gebruikersnaam);
            params.push(gebruikersnaam);
            velden.push(`gebruikersnaam = $${params.length}`);
            params.push(gebruikersnaam);
            velden.push(`gebruikersnaam_norm = $${params.length}`);
        }
        if (req.body?.display_naam != null) {
            const displayNaam = valideerDisplayNaam(req.body.display_naam, 'Host');
            params.push(displayNaam);
            velden.push(`display_naam = $${params.length}`);
        }
        if (velden.length === 0) {
            return res.status(400).json({ fout: 'Geef actief, gebruikersnaam of display_naam.' });
        }
        const { rows } = await pool.query(
            `UPDATE gebruikers SET ${velden.join(', ')} WHERE id = $1
             RETURNING id, gebruikersnaam, display_naam, actief`,
            params,
        );
        if (!rows[0]) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });
        if (req.body?.actief === false || req.body?.gebruikersnaam != null) {
            await pool.query(`DELETE FROM auth_sessies WHERE gebruiker_id = $1`, [req.params.id]);
        }
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ fout: 'Deze gebruikersnaam bestaat al.' });
        res.status(400).json({ fout: err.message || 'Gebruiker bijwerken mislukt.' });
    }
});

router.post('/api/admin/gebruikers/:id/wachtwoord', vereisAdmin, async (req, res) => {
    try {
        const wachtwoord = valideerWachtwoord(req.body?.wachtwoord);
        const hash = await hashWachtwoord(wachtwoord);
        const { rowCount } = await pool.query(
            `UPDATE gebruikers SET wachtwoord_hash = $2, actief = true WHERE id = $1`,
            [req.params.id, hash],
        );
        if (!rowCount) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });
        await pool.query(`DELETE FROM auth_sessies WHERE gebruiker_id = $1`, [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ fout: err.message || 'Wachtwoordreset mislukt.' });
    }
});

// Zoek automatisch de beste YouTube-intro voor één titel. De admin beslist
// daarna zelf of deze kandidaat wordt opgeslagen.
router.post('/api/admin/titels/:id/youtube-zoek', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar, tmdb_id FROM titels WHERE id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    try {
        const keuze = await ytzoek.zoekVoorTitel(rows[0], { pauzeMs: 100, limiet: 12 });
        if (!keuze) return res.status(404).json({ fout: 'Geen betrouwbare YouTube-match gevonden.' });
        const tmdbControle = await tmdb.controleerTrackMetTmdb(rows[0], {
            tracknaam: keuze.titel,
            artiest: keuze.kanaal,
        });
        if (!tmdbControle.past) {
            return res.status(422).json({ fout: `YouTube-match afgewezen: ${tmdbControle.reden}` });
        }
        const verificatieReden = tmdbControle.beschikbaar
            ? `${keuze._controle?.reden || 'YouTube-titelcontrole'}; ${tmdbControle.reden}`
            : keuze._controle?.reden || 'YouTube-titelcontrole';
        res.json({
            bron: 'youtube',
            preview_url: keuze.videoId,
            tracknaam: keuze.titel,
            artiest: keuze.kanaal || 'YouTube',
            bron_url: `https://www.youtube.com/watch?v=${keuze.videoId}`,
            start_seconde: 0,
            views: keuze.views ?? null,
            duur_seconden: keuze.duurSeconden ?? null,
            verificatie_score: keuze._controle?.zekerheid || 0,
            verificatie_reden: verificatieReden,
        });
    } catch (err) {
        res.status(502).json({ fout: `YouTube zoeken mislukt: ${err.message}` });
    }
});

router.post('/api/admin/titels/:id/tracks', vereisAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.preview_url || !b.tracknaam) {
        return res.status(400).json({ fout: 'preview_url en tracknaam verplicht.' });
    }
    const geldigeBron = ['itunes', 'youtube', 'lokaal'].includes(b.bron) ? b.bron : null;
    if (!geldigeBron) return res.status(400).json({ fout: 'Kies expliciet YouTube, iTunes of lokaal.' });
    if (geldigeBron === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(String(b.preview_url))) {
        return res.status(400).json({ fout: 'YouTube-track heeft geen geldig video-id.' });
    }
    const titelRij = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar, tmdb_id FROM titels WHERE id = $1`,
        [req.params.id],
    );
    if (!titelRij.rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });

    const titel = titelRij.rows[0];
    let controle = geldigeBron === 'lokaal'
        ? { past: true, zekerheid: 1, reden: 'handmatig lokaal bestand door admin' }
        : pastBijTitel(titel, {
            tracknaam: b.tracknaam,
            album: b.album,
            artiest: b.artiest,
        });
    if (!controle.past) {
        return res.status(422).json({
            fout: `Track afgewezen: ${controle.reden}. Voeg de volledige titel/alias toe aan de tracknaam of het album.`,
        });
    }
    if (geldigeBron !== 'lokaal') {
        const tmdbControle = await tmdb.controleerTrackMetTmdb(titel, {
            tracknaam: b.tracknaam,
            album: b.album,
            artiest: b.artiest,
        });
        if (!tmdbControle.past) {
            return res.status(422).json({ fout: `Track afgewezen door TMDB: ${tmdbControle.reden}` });
        }
        if (tmdbControle.beschikbaar) {
            controle = { ...controle, reden: `${controle.reden}; ${tmdbControle.reden}` };
        }
    }

    const { rows } = await pool.query(
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             start_seconde, tracknaam, artiest, album,
                             herkenbaarheid, gecontroleerd, verificatie_score,
                             verificatie_reden, laatst_gecontroleerd_op, bron_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, now(), $12)
         RETURNING *`,
        [
            req.params.id,
            geldigeBron,
            b.itunes_track_id ?? null,
            b.preview_url,
            Number.isFinite(b.start_seconde) ? b.start_seconde : 0,
            b.tracknaam,
            b.artiest || '',
            b.album || null,
            Number.isFinite(b.herkenbaarheid) ? b.herkenbaarheid : 3,
            controle.zekerheid,
            controle.reden,
            b.bron_url || (geldigeBron === 'youtube'
                ? `https://www.youtube.com/watch?v=${b.preview_url}`
                : b.preview_url),
        ],
    );
    await pool.query(
        `UPDATE meldingen SET afgehandeld = true
          WHERE titel_id = $1 AND soort = 'geen_track' AND afgehandeld = false`,
        [req.params.id],
    );
    res.json(rows[0]);
});

router.delete('/api/admin/tracks/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM tracks WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

router.post('/api/admin/tracks/:id/download', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, tr.bron_url, tr.tracknaam,
                tr.start_seconde,
                t.naam
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          WHERE tr.id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Track niet gevonden.' });
    if (!['itunes', 'youtube'].includes(rows[0].bron)) {
        return res.status(400).json({ fout: 'Alleen YouTube- of iTunes-tracks kunnen vooraf worden gedownload.' });
    }
    try {
        await controleerTrackUrl(rows[0]);
        await downloadTrack({ ...rows[0], naam: rows[0].tracknaam || rows[0].naam });
        res.json({ ok: true, opgeslagen: true, map: process.env.DOWNLOAD_DIR || '/media/downloads' });
    } catch (err) {
        res.status(502).json({ fout: err.message });
    }
});

// Upload een eigen/gelicentieerd audiobestand. Het bestand blijft in het
// gemounte /media-volume en krijgt een unieke naam; de originele uploadnaam
// wordt nooit als pad gebruikt.
router.post(
    '/api/admin/titels/:id/tracks/upload',
    vereisAdmin,
    uploadAudio,
    async (req, res) => {
        if (!req.file) return res.status(400).json({ fout: 'Kies een audiobestand.' });
        const { rows: titels } = await pool.query(
            `SELECT id, naam FROM titels WHERE id = $1`,
            [req.params.id],
        );
        if (!titels[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });

        const extensie = path.extname(req.file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
        const audioExtensies = ['.mp3', '.m4a', '.mp4', '.wav', '.ogg', '.oga', '.webm', '.aac', '.flac'];
        const type = String(req.file.mimetype || '').toLowerCase();
        if (!type.startsWith('audio/') && !audioExtensies.includes(extensie)) {
            return res.status(415).json({ fout: 'Upload een audiobestand (mp3, m4a, wav, ogg of webm).' });
        }
        const veiligeExtensie = audioExtensies.includes(extensie)
            ? extensie
            : '.audio';
        const bestandsnaam = `upload-${req.params.id}-${crypto.randomUUID()}${veiligeExtensie}`;
        const absoluut = path.join(UPLOAD_DIR, bestandsnaam);
        const lokaal = `/media/uploads/${bestandsnaam}`;
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

        try {
            await fs.mkdir(UPLOAD_DIR, { recursive: true });
            await fs.writeFile(absoluut, req.file.buffer, { flag: 'wx' });
            const titelNaam = String(req.body?.tracknaam || titels[0].naam).trim().slice(0, 200);
            const artiest = String(req.body?.artiest || 'Eigen upload').trim().slice(0, 200);
            const { rows } = await pool.query(
                `INSERT INTO tracks
                    (titel_id, bron, preview_url, bestand_pad, tracknaam, artiest,
                     herkenbaarheid, gecontroleerd, verificatie_score,
                     verificatie_reden, bron_url, download_status, audio_sha256, gedownload_op)
                 VALUES ($1, 'lokaal', $2, $2, $3, $4, 5, true, 1,
                         'handmatig audiobestand door admin', $5, 'available', $6, now())
                 RETURNING *`,
                [req.params.id, lokaal, titelNaam, artiest, req.file.originalname, hash],
            );
            await pool.query(
                `UPDATE meldingen SET afgehandeld = true
                  WHERE titel_id = $1 AND soort = 'geen_track' AND afgehandeld = false`,
                [req.params.id],
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            await fs.unlink(absoluut).catch(() => {});
            res.status(500).json({ fout: `Upload opslaan mislukt: ${err.message}` });
        }
    },
);

// ---- Meldingen (fouten die spelers doorgaven) ----
router.get('/api/admin/meldingen', vereisAdmin, async (req, res) => {
    const alle = req.query.alle === '1';
    const { rows } = await pool.query(
        `SELECT m.id, m.soort, m.toelichting, m.afgehandeld, m.aangemaakt_op,
                t.id AS titel_id, t.naam AS titel_naam,
                tr.id AS track_id, tr.bron, tr.preview_url, tr.tracknaam
           FROM meldingen m
           LEFT JOIN titels t  ON t.id = m.titel_id
           LEFT JOIN tracks tr ON tr.id = m.track_id
          WHERE $1 OR m.afgehandeld = false
          ORDER BY m.aangemaakt_op DESC
          LIMIT 200`,
        [alle],
    );
    res.json(rows);
});

router.post('/api/admin/meldingen/:id/afgehandeld', vereisAdmin, async (req, res) => {
    await pool.query(`UPDATE meldingen SET afgehandeld = true WHERE id = $1`, [
        req.params.id,
    ]);
    res.json({ ok: true });
});

// ---- Seed importeren (YouTube → iTunes fallback) ----
// Draait in de achtergrond: ~290 titels duurt langer dan een tunnel/proxy
// een HTTP-verzoek openhoudt. De client vraagt de status apart op.
let seedStatus = {
    bezig: false,
    klaar: false,
    gestart_op: null,
    samenvatting: null,
    fout: null,
};

let playlistImportStatus = {
    bezig: false,
    klaar: false,
    samenvatting: null,
    fout: null,
};
let tmdbImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let vragenImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let downloadStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let collectieImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
// Imports wijzigen dezelfde vragenbank. Eén gedeelde lock voorkomt dat twee
// admins (of twee browservensters) tegelijk tracks/titels gaan vervangen.
let actieveAdminTaak = null;

function startAdminScript(naam, status, setter, werk) {
    if (actieveAdminTaak || status.bezig) {
        return {
            gestart: false,
            bezig: true,
            taak: actieveAdminTaak || naam,
        };
    }
    const nieuw = {
        bezig: true,
        klaar: false,
        gestart_op: new Date().toISOString(),
        samenvatting: null,
        fout: null,
    };
    actieveAdminTaak = naam;
    setter(nieuw);
    Promise.resolve()
        .then(werk)
        .then((samenvatting) => {
            setter({ ...nieuw, bezig: false, klaar: true, samenvatting });
        })
        .catch((err) => {
            setter({ ...nieuw, bezig: false, klaar: true, fout: err.message });
            logger.fout(`Admin-taak mislukt: ${naam}.`, { melding: err.message });
        })
        .finally(() => {
            if (actieveAdminTaak === naam) actieveAdminTaak = null;
        });
    return { gestart: true, bezig: true, taak: naam };
}

async function downloadTracksVooruit({ collecties = [], force = false, controleer = true } = {}) {
    const sleutels = normaliseerCollecties(collecties);
    const params = [];
    let extra = '';
    if (sleutels.length) {
        params.push(sleutels);
        extra = `AND EXISTS (
            SELECT 1 FROM titel_collecties tc
            JOIN collecties c ON c.id = tc.collectie_id
            WHERE tc.titel_id = t.id AND c.sleutel = ANY($${params.length}::text[])
        )`;
    }
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, tr.bron_url, tr.tracknaam,
                tr.start_seconde, tr.download_status, t.naam
           FROM tracks tr JOIN titels t ON t.id = tr.titel_id
          WHERE tr.werkt = true
            AND tr.bron IN ('youtube', 'itunes')
            AND tr.preview_url IS NOT NULL AND tr.preview_url <> ''
            ${extra}
          ORDER BY tr.id`,
        params,
    );
    let gedownload = 0;
    let overgeslagen = 0;
    let mislukt = 0;
    const fouten = [];
    for (const track of rows) {
        if (!force && track.download_status === 'available') {
            overgeslagen++;
            continue;
        }
        try {
            if (controleer) await controleerTrackUrl(track);
            await downloadTrack(track);
            gedownload++;
        } catch (err) {
            mislukt++;
            fouten.push({ id: track.id, naam: track.naam, fout: err.message });
            await pool.query(
                `UPDATE tracks SET download_status = 'failed', download_melding = $2 WHERE id = $1`,
                [track.id, String(err.message).slice(0, 500)],
            ).catch(() => {});
        }
    }
    return {
        verwerkt: rows.length,
        gedownload,
        overgeslagen,
        mislukt,
        fouten: fouten.slice(0, 100),
        map: process.env.DOWNLOAD_DIR || '/media/downloads',
    };
}

router.post('/api/admin/downloads/start', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'downloads',
        downloadStatus,
        (v) => { downloadStatus = v; },
        async () => {
            const collecties = Array.isArray(req.body?.collecties) ? req.body.collecties : [];
            logger.info('Vooraf downloaden gestart via admin.', { collecties });
            return downloadTracksVooruit({
                collecties,
                force: req.body?.force === true,
                controleer: req.body?.controleer !== false,
            });
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/downloads/status', vereisAdmin, (_req, res) => {
    res.json(downloadStatus);
});

router.post('/api/admin/collecties/import', vereisAdmin, (req, res) => {
    const collecties = normaliseerCollecties(req.body?.collecties);
    if (!collecties.length) return res.status(400).json({ fout: 'Kies minimaal één collectie.' });
    const antwoord = startAdminScript(
        'collecties',
        collectieImportStatus,
        (v) => { collectieImportStatus = v; },
        async () => {
            const imports = [];
            for (const collectie of collecties) {
                imports.push({ collectie, resultaat: await importeer({ collectie, force: true }) });
            }
            const downloads = req.body?.download === false
                ? null
                : await downloadTracksVooruit({ collecties, controleer: true });
            return { imports, downloads };
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/collecties/import/status', vereisAdmin, (_req, res) => {
    res.json(collectieImportStatus);
});

router.post('/api/admin/seed', vereisAdmin, (req, res) => {
    const force = !!(req.body && req.body.force);
    const antwoord = startAdminScript(
        'seed',
        seedStatus,
        (v) => { seedStatus = v; },
        async () => {
            logger.info('Seed-import gestart via admin (YouTube eerst, iTunes fallback).');
            const samenvatting = await importeer({ force });
            logger.info('Seed-import klaar.', samenvatting);
            return samenvatting;
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/seed/status', vereisAdmin, (_req, res) => {
    res.json(seedStatus);
});

router.post('/api/admin/playlists/import', vereisAdmin, (req, res) => {
    const titelFilter = String(req.body?.titel || '').trim();
    const antwoord = startAdminScript(
        'playlists',
        playlistImportStatus,
        (v) => { playlistImportStatus = v; },
        async () => {
            const samenvatting = await importeerPlaylists({ titelFilter });
            logger.info('YouTube-playlist-import klaar.', samenvatting);
            return samenvatting;
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/playlists/status', vereisAdmin, (_req, res) => {
    res.json(playlistImportStatus);
});

router.post('/api/admin/tmdb/import', vereisAdmin, (req, res) => {
    const type = ['film', 'serie', 'beide'].includes(req.body?.type) ? req.body.type : 'beide';
    const antwoord = startAdminScript(
        'tmdb',
        tmdbImportStatus,
        (v) => { tmdbImportStatus = v; },
        () => importeerTmdb({ type }),
    );
    res.json(antwoord);
});

router.get('/api/admin/tmdb/status', vereisAdmin, (_req, res) => {
    res.json(tmdbImportStatus);
});

router.post('/api/admin/vragen/import', vereisAdmin, (req, res) => {
    const metTmdb = !!req.body?.tmdb;
    const antwoord = startAdminScript(
        'vragen',
        vragenImportStatus,
        (v) => { vragenImportStatus = v; },
        () => importeerVragen({ metTmdb }),
    );
    res.json(antwoord);
});

router.get('/api/admin/vragen/status', vereisAdmin, (_req, res) => {
    res.json(vragenImportStatus);
});

module.exports = router;
