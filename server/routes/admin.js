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
//   POST   /api/admin/seed            (YouTube-import; geen iTunes-preview)
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
const { importeerTmdb, importeerJaarCatalogus } = require('../../seed/tmdb-import');
const { importeerVragen } = require('../../seed/vragen-import');
const { pastBijTitel } = require('../lib/trackcheck');
const ytzoek = require('../lib/ytzoek');
const tmdb = require('../lib/tmdb');
const {
    downloadTrack,
    controleerTrackUrl,
    controleerLokaleBestanden,
    isAppleTrack,
} = require('../../seed/download-track');
const { absoluutPad } = require('../lib/media-health');
const {
    hashWachtwoord,
    valideerWachtwoord,
    valideerGebruikersnaam,
    valideerDisplayNaam,
} = require('../lib/auth');
const { veiligeTiteltekst, veiligeMetadata } = require('../lib/content-filter');

const router = express.Router();

const COOKIE = 'ventune_admin';
const HTTPS = (process.env.APP_URL || '').startsWith('https');
const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(MEDIA_DIR, 'uploads');
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(MEDIA_DIR, 'downloads');
const DEFAULT_BATCH_GROOTTE = 5;
const MAX_BATCH_GROOTTE = 50;

function begrensBatchGrootte(waarde) {
    const getal = Number(waarde);
    if (!Number.isFinite(getal)) return DEFAULT_BATCH_GROOTTE;
    return Math.min(MAX_BATCH_GROOTTE, Math.max(1, Math.floor(getal)));
}
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

function isVeiligMediaPad(absoluut) {
    if (!absoluut) return false;
    const opgelost = path.resolve(absoluut);
    const roots = [DOWNLOAD_DIR, UPLOAD_DIR].map((dir) => path.resolve(dir));
    return roots.some((root) => opgelost === root || opgelost.startsWith(`${root}${path.sep}`));
}

async function verwijderMediaBestand(track) {
    if (!track || track.bron !== 'lokaal') return { verwijderd: false };
    const absoluut = absoluutPad(track.bestand_pad || track.preview_url, MEDIA_DIR);
    if (!isVeiligMediaPad(absoluut)) return { verwijderd: false, overgeslagen: true };
    try {
        await fs.unlink(absoluut);
        return { verwijderd: true, pad: track.bestand_pad || track.preview_url };
    } catch (err) {
        if (err.code === 'ENOENT') return { verwijderd: false, ontbreekt: true };
        throw err;
    }
}

async function lokaleTracksVoorTitel(titelId) {
    const { rows } = await pool.query(
        `SELECT id, bron, preview_url, bestand_pad FROM tracks
          WHERE titel_id = $1 AND bron = 'lokaal'`,
        [titelId],
    );
    return rows;
}

async function ruimWeesMediaOp() {
    const bekende = new Set();
    const { rows } = await pool.query(
        `SELECT preview_url, bestand_pad FROM tracks WHERE bron = 'lokaal'`,
    );
    for (const track of rows) {
        for (const waarde of [track.preview_url, track.bestand_pad]) {
            const absoluut = absoluutPad(waarde, MEDIA_DIR);
            if (absoluut && isVeiligMediaPad(absoluut)) bekende.add(path.resolve(absoluut));
        }
    }
    let gecontroleerd = 0;
    let verwijderd = 0;
    const fouten = [];
    for (const dir of [DOWNLOAD_DIR, UPLOAD_DIR]) {
        let bestanden = [];
        try {
            bestanden = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
            if (err.code !== 'ENOENT') fouten.push({ dir, fout: err.message });
            continue;
        }
        for (const item of bestanden) {
            if (!item.isFile()) continue;
            const absoluut = path.resolve(path.join(dir, item.name));
            gecontroleerd++;
            if (bekende.has(absoluut) || !isVeiligMediaPad(absoluut)) continue;
            try {
                await fs.unlink(absoluut);
                verwijderd++;
            } catch (err) {
                fouten.push({ bestand: absoluut, fout: err.message });
            }
        }
    }
    return { gecontroleerd, verwijderd, fouten: fouten.slice(0, 50) };
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
    const filter = String(req.query.filter || '').trim().toLowerCase();
    const taal = String(req.query.taal || '').trim().toLowerCase();
    const params = [];
    const voorwaarden = [];
    if (zoek) {
        params.push(`%${zoek}%`);
        voorwaarden.push(`t.naam ILIKE $${params.length}`);
    }
    if (filter === 'zonder-track') {
        voorwaarden.push(`NOT EXISTS (
            SELECT 1 FROM tracks x
             WHERE x.titel_id = t.id AND x.werkt = true
               AND x.preview_url IS NOT NULL AND x.preview_url <> ''
        )`);
    } else if (filter === 'speelbaar') {
        voorwaarden.push(`EXISTS (
            SELECT 1 FROM tracks x
             WHERE x.titel_id = t.id AND x.werkt = true
               AND x.bron = 'lokaal' AND x.download_status = 'available'
               AND x.itunes_track_id IS NULL
               AND x.preview_url IS NOT NULL AND x.preview_url <> ''
        )`);
    } else if (filter === 'afgekeurd') {
        voorwaarden.push(`EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id AND x.werkt = false)`);
    } else if (filter === 'zonder-vraag') {
        voorwaarden.push(`NOT EXISTS (SELECT 1 FROM vragen v WHERE v.titel_id = t.id)`);
    } else if (filter === 'gecurateerd') {
        voorwaarden.push(`t.nl_tv_bekend = true AND t.curatie_status = 'goedgekeurd'`);
    } else if (['film', 'serie'].includes(filter)) {
        voorwaarden.push(`t.type = '${filter}'`);
    } else if (filter === 'lokaal') {
        voorwaarden.push(`EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
            AND x.werkt = true AND x.bron = 'lokaal'
            AND x.itunes_track_id IS NULL AND x.download_status = 'available')`);
    } else if (filter === 'zonder-lokaal') {
        voorwaarden.push(`NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
            AND x.werkt = true AND x.bron = 'lokaal'
            AND x.itunes_track_id IS NULL AND x.download_status = 'available')`);
    } else if (filter === 'youtube') {
        voorwaarden.push(`EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id AND x.werkt = true AND x.bron = 'youtube')`);
    } else if (filter === 'itunes') {
        voorwaarden.push(`EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id AND x.werkt = true AND x.bron = 'itunes')`);
    } else if (filter === 'met-melding') {
        voorwaarden.push(`EXISTS (SELECT 1 FROM meldingen m WHERE m.titel_id = t.id AND m.afgehandeld = false)`);
    } else if (filter === 'te-beoordelen') {
        voorwaarden.push(`t.curatie_status = 'te_beoordelen'`);
    } else if (filter === 'studio-ontbreekt') {
        voorwaarden.push(`NULLIF(BTRIM(t.studio), '') IS NULL`);
    } else if (/^leeftijd-(0|6|9|10|12|16|18)$/.test(filter)) {
        const leeftijd = Number(filter.split('-')[1]);
        voorwaarden.push(`t.leeftijdsgrens <= ${leeftijd}`);
    }
    if (['nl', 'en'].includes(taal)) {
        params.push(taal);
        voorwaarden.push(`t.taal = $${params.length}`);
    }
    const where = voorwaarden.length ? `WHERE ${voorwaarden.join(' AND ')}` : '';
    const { rows } = await pool.query(
        `SELECT t.*, COUNT(DISTINCT tr.id)::int AS aantal_tracks,
                COUNT(DISTINCT tr.id) FILTER (WHERE tr.werkt = true AND tr.preview_url IS NOT NULL AND tr.preview_url <> '')::int AS werkende_tracks,
                COUNT(DISTINCT tr.id) FILTER (WHERE tr.werkt = true AND tr.bron = 'lokaal'
                    AND tr.itunes_track_id IS NULL AND tr.download_status = 'available')::int AS lokale_tracks,
                COUNT(DISTINCT tr.id) FILTER (WHERE tr.werkt = true AND tr.bron = 'youtube')::int AS youtube_tracks,
                COUNT(DISTINCT tr.id) FILTER (WHERE tr.werkt = true AND tr.bron = 'itunes')::int AS itunes_tracks,
                COUNT(DISTINCT tr.id) FILTER (WHERE tr.download_status = 'failed')::int AS download_fouten,
                COUNT(DISTINCT m.id) FILTER (WHERE m.afgehandeld = false)::int AS open_meldingen,
                MAX(tr.laatst_gecontroleerd_op) AS laatste_controle,
                COALESCE(array_agg(DISTINCT c.sleutel) FILTER (WHERE c.sleutel IS NOT NULL), '{}') AS collecties
           FROM titels t
           LEFT JOIN tracks tr ON tr.titel_id = t.id
           LEFT JOIN meldingen m ON m.titel_id = t.id
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
              speelplek, studio, toevoeg_reden, nl_tv_bekend, curatie_status, leeftijdsgrens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
            b.studio || null,
            b.toevoeg_reden || 'Handmatig toegevoegd door de admin.',
            b.nl_tv_bekend !== false,
            ['goedgekeurd', 'te_beoordelen', 'uitgesloten'].includes(b.curatie_status)
                ? b.curatie_status : 'goedgekeurd',
            [0, 6, 9, 10, 12, 16, 18].includes(Number(b.leeftijdsgrens))
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
                hoofdrollen = $10, speelplek = $11, studio = $12, toevoeg_reden = $13,
                nl_tv_bekend = $14, curatie_status = $15, leeftijdsgrens = $16
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
            b.studio || null,
            b.toevoeg_reden || 'Handmatig bijgewerkt door de admin.',
            b.nl_tv_bekend !== false,
            ['goedgekeurd', 'te_beoordelen', 'uitgesloten'].includes(b.curatie_status)
                ? b.curatie_status : 'goedgekeurd',
            [0, 6, 9, 10, 12, 16, 18].includes(Number(b.leeftijdsgrens))
                ? Number(b.leeftijdsgrens) : 16,
        ],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    if (b.collecties !== undefined) await bewaarTitelCollecties(rows[0].id, b.collecties);
    res.json(rows[0]);
});

router.delete('/api/admin/titels/:id', vereisAdmin, async (req, res) => {
    const tracks = await lokaleTracksVoorTitel(req.params.id);
    const { rowCount } = await pool.query(`DELETE FROM titels WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ fout: 'Titel niet gevonden.' });
    let bestandenVerwijderd = 0;
    for (const track of tracks) {
        const resultaat = await verwijderMediaBestand(track);
        if (resultaat.verwijderd) bestandenVerwijderd++;
    }
    res.json({ ok: true, verwijderd: rowCount, bestanden_verwijderd: bestandenVerwijderd });
});

router.post('/api/admin/titels/bulk-delete', vereisAdmin, async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500)
        : [];
    if (!ids.length) return res.status(400).json({ fout: 'Kies minimaal één titel.' });
    const tracks = await pool.query(
        `SELECT id, titel_id, bron, preview_url, bestand_pad FROM tracks
          WHERE titel_id = ANY($1::int[]) AND bron = 'lokaal'`,
        [ids],
    );
    const { rowCount } = await pool.query(`DELETE FROM titels WHERE id = ANY($1::int[])`, [ids]);
    let bestandenVerwijderd = 0;
    for (const track of tracks.rows) {
        const resultaat = await verwijderMediaBestand(track);
        if (resultaat.verwijderd) bestandenVerwijderd++;
    }
    res.json({ ok: true, verwijderd: rowCount, bestanden_verwijderd: bestandenVerwijderd });
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
          ORDER BY werkt DESC,
                   CASE
                       WHEN bron = 'lokaal'
                            AND lower(COALESCE(bron_url, '')) LIKE '%youtube%' THEN 5
                       WHEN bron = 'youtube' THEN 4
                       WHEN bron = 'lokaal' THEN 3
                       WHEN bron = 'itunes' THEN 2
                       ELSE 1
                   END DESC,
                   fout_aantal ASC, keer_gespeeld ASC,
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
        // Keur jij een track goed, dan staat de koppeling vast. Het spel gaat
        // hem daarna niet meer automatisch afkeuren omdat de filmnaam
        // toevallig niet in de tracknaam staat.
        velden.push(`bevestigd = $${params.length}`);
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

// Spelersuggesties voor bonusvragen. Open suggesties worden hier beoordeeld;
// goedkeuren kopieert de vraag naar de normale, vooraf geladen vragenbank.
router.get('/api/admin/vraag-suggesties', vereisAdmin, async (req, res) => {
    const status = ['open', 'goedgekeurd', 'afgewezen'].includes(req.query.status)
        ? req.query.status : 'open';
    const { rows } = await pool.query(
        `SELECT s.*, t.naam AS titel_naam, t.type AS titel_type, t.jaar AS titel_jaar
           FROM vraag_suggesties s
           JOIN titels t ON t.id = s.titel_id
          WHERE s.status = $1
          ORDER BY s.aangemaakt_op DESC
          LIMIT 300`,
        [status],
    );
    res.json(rows);
});

router.post('/api/admin/vraag-suggesties/:id/goedkeuren', vereisAdmin, async (req, res) => {
    const suggestie = await pool.query(
        `SELECT * FROM vraag_suggesties WHERE id = $1 AND status = 'open'`,
        [req.params.id],
    );
    if (!suggestie.rows[0]) return res.status(404).json({ fout: 'Open bonusvraag niet gevonden.' });
    const s = suggestie.rows[0];
    try {
        const vraag = await pool.query(
            `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index)
             VALUES ($1, 'speler', $2, $3::jsonb, $4)
             ON CONFLICT (titel_id, soort, vraag) DO UPDATE
                 SET opties = EXCLUDED.opties, correct_index = EXCLUDED.correct_index
             RETURNING *`,
            [s.titel_id, s.vraag, JSON.stringify(s.opties), s.correct_index],
        );
        await pool.query(
            `UPDATE vraag_suggesties SET status = 'goedgekeurd', beoordeeld_op = now()
              WHERE id = $1`,
            [req.params.id],
        );
        res.json({ ok: true, vraag: vraag.rows[0] });
    } catch (err) {
        res.status(400).json({ fout: `Bonusvraag goedkeuren mislukt: ${err.message}` });
    }
});

router.post('/api/admin/vraag-suggesties/:id/afwijzen', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `UPDATE vraag_suggesties
            SET status = 'afgewezen', toelichting = $2, beoordeeld_op = now()
          WHERE id = $1 AND status = 'open'
          RETURNING *`,
        [req.params.id, String(req.body?.toelichting || '').trim().slice(0, 500) || null],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Open bonusvraag niet gevonden.' });
    res.json({ ok: true, suggestie: rows[0] });
});

router.delete('/api/admin/vragen/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM vragen WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// Overzicht: hoe staat de vragenbank ervoor?
router.get('/api/admin/overzicht', vereisAdmin, async (_req, res) => {
    const leeg = {
        titels: 0,
        films: 0,
        series: 0,
        bekende_titels: 0,
        tracks: 0,
        afgekeurd: 0,
        gecontroleerd: 0,
        speelbaar: 0,
        vragen: 0,
        open_meldingen: 0,
        ontbrekende_tracks: 0,
        cache_regels: 0,
        zoek_log_regels: 0,
        per_bron: [],
    };
    try {
        const d = await pool.query(
            `SELECT
               (SELECT count(*)::int FROM titels) AS titels,
               (SELECT count(*)::int FROM titels WHERE type = 'film') AS films,
               (SELECT count(*)::int FROM titels WHERE type = 'serie') AS series,
               (SELECT count(*)::int FROM titels WHERE nl_tv_bekend = true AND curatie_status = 'goedgekeurd') AS bekende_titels,
               (SELECT count(*)::int FROM tracks) AS tracks,
               (SELECT count(*)::int FROM tracks WHERE werkt = false) AS afgekeurd,
               (SELECT count(*)::int FROM tracks WHERE gecontroleerd) AS gecontroleerd,
               (SELECT count(*)::int FROM tracks WHERE bevestigd) AS bevestigd,
               (SELECT count(*)::int FROM titels t
                 WHERE EXISTS (SELECT 1 FROM tracks x
                                WHERE x.titel_id = t.id AND x.werkt
                                  AND x.bron = 'lokaal'
                                  AND x.itunes_track_id IS NULL
                                  AND x.download_status = 'available'
                                  AND x.preview_url IS NOT NULL AND x.preview_url <> '')) AS speelbaar,
               (SELECT count(*)::int FROM vragen) AS vragen,
               (SELECT count(*)::int FROM meldingen WHERE afgehandeld = false) AS open_meldingen,
               (SELECT count(*)::int FROM titels t
                 WHERE NOT EXISTS (SELECT 1 FROM tracks x
                                    WHERE x.titel_id = t.id AND x.werkt
                                      AND x.bron = 'lokaal'
                                      AND x.itunes_track_id IS NULL
                                      AND x.download_status = 'available'
                                      AND x.preview_url IS NOT NULL AND x.preview_url <> ''))
                 AS ontbrekende_tracks,
               (SELECT count(*)::int FROM zoek_cache) AS cache_regels`,
        );

        // Stand van de zoekwachtrij: wat kan er nu, wat wacht, wat is
        // opgegeven. Zonder deze cijfers is niet te zien of de pijplijn
        // vooruitgaat of vastzit.
        let wachtrij = { direct: 0, wachtend: 0, opgegeven: 0 };
        try {
            const resultaat = await pool.query(
                `SELECT
                   count(*) FILTER (
                       WHERE t.zoek_status <> 'opgegeven'
                         AND (t.volgende_poging IS NULL OR t.volgende_poging <= now())
                   )::int AS direct,
                   count(*) FILTER (WHERE t.volgende_poging > now())::int AS wachtend,
                   count(*) FILTER (WHERE t.zoek_status = 'opgegeven')::int AS opgegeven
                 FROM titels t
                WHERE NOT EXISTS (SELECT 1 FROM tracks x
                                   WHERE x.titel_id = t.id AND x.werkt
                                     AND x.preview_url IS NOT NULL AND x.preview_url <> ''
                                     AND (x.bron = 'youtube'
                                          OR (x.bron = 'lokaal' AND x.itunes_track_id IS NULL
                                              AND x.download_status = 'available')))`,
            );
            wachtrij = resultaat.rows[0];
        } catch (err) {
            logger.waarschuwing('Zoekwachtrij in overzicht mislukt.', { melding: err.message });
        }

        // Hoeveel titels hebben wel een YouTube-kandidaat maar nog geen MP3?
        // Dat is precies het werk dat de downloadstap moet doen.
        let teDownloaden = 0;
        try {
            const resultaat = await pool.query(
                `SELECT count(*)::int AS n FROM tracks tr
                  WHERE tr.werkt = true AND tr.bron = 'youtube'
                    AND tr.preview_url IS NOT NULL AND tr.preview_url <> ''
                    AND tr.download_status <> 'available'
                    AND NOT EXISTS (SELECT 1 FROM tracks lokaal
                                     WHERE lokaal.titel_id = tr.titel_id
                                       AND lokaal.bron = 'lokaal'
                                       AND lokaal.itunes_track_id IS NULL
                                       AND lokaal.werkt = true
                                       AND lokaal.download_status = 'available')`,
            );
            teDownloaden = resultaat.rows[0]?.n || 0;
        } catch (err) {
            logger.waarschuwing('Downloadtelling in overzicht mislukt.', { melding: err.message });
        }
        const fouten = [];
        let perBron = [];
        try {
            const resultaat = await pool.query(
                `SELECT bron, count(*)::int AS n
                   FROM tracks
                  GROUP BY bron
                  ORDER BY CASE bron
                               WHEN 'lokaal' THEN 0
                               WHEN 'youtube' THEN 1
                               WHEN 'itunes' THEN 2
                               ELSE 3
                           END, n DESC`,
            );
            perBron = resultaat.rows;
        } catch (err) {
            fouten.push(`Audiobronnen: ${err.message}`);
            logger.waarschuwing('Audiobronnen in overzicht mislukt.', { melding: err.message });
        }

        // Zoeklog is een latere migratie. Als een bestaande database nog niet
        // is gemigreerd, mogen de gewone tellingen niet allemaal in de
        // fallback op nul vallen.
        let zoekLogRegels = 0;
        try {
            const resultaat = await pool.query('SELECT count(*)::int AS n FROM zoek_log');
            zoekLogRegels = resultaat.rows[0]?.n || 0;
        } catch (err) {
            fouten.push(`Zoeklog: ${err.message}`);
            logger.waarschuwing('Zoeklog in overzicht ontbreekt of is onleesbaar.', { melding: err.message });
        }

        res.json({
            ...d.rows[0],
            per_bron: perBron,
            zoek_log_regels: zoekLogRegels,
            zoek_direct: wachtrij.direct,
            zoek_wachtend: wachtrij.wachtend,
            zoek_opgegeven: wachtrij.opgegeven,
            te_downloaden: teDownloaden,
            ...(fouten.length ? { fout: fouten.join(' | ') } : {}),
        });
    } catch (err) {
        logger.waarschuwing('Overzicht mislukt.', { melding: err.message });
        // Het overzicht blijft bruikbaar op een oudere database tijdens een
        // migratie. Geef de admin wel de echte oorzaak, anders zijn nullen en
        // streepjes niet van een lege database te onderscheiden.
        res.json({
            ...leeg,
            fout: `Overzicht-query mislukt: ${err.message}`,
        });
    }
});

// ---- Applicatie-instellingen / uiterlijk ----
const THEMA_SLEUTELS = [
    'appNaam', 'ondertitel', 'logoPad', 'achtergrond', 'oppervlak', 'rand',
    'accent', 'accentDonker', 'tekst', 'tekstDim', 'lettertype', 'fontSchaal',
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
        } else if (sleutel === 'fontSchaal') {
            const schaal = Number(input[sleutel]);
            if (Number.isFinite(schaal) && schaal >= 0.85 && schaal <= 1.4) uitkomst[sleutel] = schaal;
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
        oude_zoekcache: `DELETE FROM zoek_cache WHERE opgehaald_op < now() - interval '7 days'`,
        afgehandelde_meldingen: `DELETE FROM meldingen WHERE afgehandeld = true`,
        spelgeschiedenis: `DELETE FROM lobbies WHERE status = 'afgelopen'`,
        afgekeurde_tracks: `DELETE FROM tracks WHERE werkt = false`,
    };
    if (!acties[actie]) {
        if (actie === 'wees_media') {
            const resultaat = await ruimWeesMediaOp();
            return res.json({ ok: true, actie, verwijderd: resultaat.verwijderd, ...resultaat });
        }
        if (actie !== 'onveilige_tekens') {
            return res.status(400).json({ fout: 'Onbekende opschoonactie.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const titels = await client.query(
                `SELECT id, naam, curatie_status FROM titels
                  WHERE curatie_status <> 'goedgekeurd'`,
            );
            let titelsUitgesloten = 0;
            for (const titel of titels.rows) {
                if (!veiligeTiteltekst(titel.naam)) {
                    await client.query(
                        `UPDATE titels SET curatie_status = 'uitgesloten', nl_tv_bekend = false
                          WHERE id = $1`,
                        [titel.id],
                    );
                    titelsUitgesloten++;
                }
            }
            const tracks = await client.query(
                `SELECT id, tracknaam, artiest, album FROM tracks WHERE werkt = true`,
            );
            let tracksUitgeschakeld = 0;
            for (const track of tracks.rows) {
                if (!veiligeMetadata(track.tracknaam, track.artiest, track.album)) {
                    await client.query(
                        `UPDATE tracks SET werkt = false,
                                verificatie_reden = 'Automatisch uitgesloten: onveilige tekens in audiometadata.'
                          WHERE id = $1`,
                        [track.id],
                    );
                    tracksUitgeschakeld++;
                }
            }
            await client.query('COMMIT');
            return res.json({
                ok: true,
                actie,
                verwijderd: 0,
                titelsUitgesloten,
                tracksUitgeschakeld,
                melding: 'Onveilige entries zijn uitgesloten; er is niets fysiek verwijderd.',
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
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
        zoek_log: 'SELECT * FROM zoek_log ORDER BY id',
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
                               AND tr.bron = 'lokaal'
                               AND tr.itunes_track_id IS NULL
                               AND tr.download_status = 'available'
                               AND tr.preview_url IS NOT NULL
                               AND tr.preview_url <> '')
          ORDER BY t.naam ASC
          LIMIT 500`,
    );
    res.json(rows);
});

// Verdieping van het overzicht: bedoeld voor een admin die wil weten of de
// catalogus groot is, maar de veilige speelpool nog klein blijft.
router.get('/api/admin/kwaliteit', vereisAdmin, async (_req, res) => {
    try {
        const [verificatie, downloads, meldingen, titels] = await Promise.all([
            pool.query(`SELECT
                COUNT(*)::int AS totaal,
                COUNT(*) FILTER (WHERE gecontroleerd = true AND verificatie_score >= 0.85)::int AS gecontroleerd,
                COUNT(*) FILTER (WHERE verificatie_score < 0.85)::int AS onzeker,
                ROUND(COALESCE(AVG(verificatie_score), 0)::numeric, 3)::float AS gemiddelde
              FROM tracks
             WHERE werkt = true AND bron = 'lokaal'
               AND itunes_track_id IS NULL AND download_status = 'available'`),
            pool.query(`SELECT download_status, COUNT(*)::int AS aantal
              FROM tracks GROUP BY download_status ORDER BY download_status`),
            pool.query(`SELECT soort, COUNT(*)::int AS aantal
              FROM meldingen WHERE afgehandeld = false GROUP BY soort ORDER BY aantal DESC`),
            pool.query(`SELECT t.id, t.naam, t.type, t.jaar,
                    (SELECT COUNT(*)::int FROM tracks tr WHERE tr.titel_id = t.id) AS tracks,
                    (SELECT COUNT(*)::int FROM tracks tr WHERE tr.titel_id = t.id AND tr.werkt AND tr.gecontroleerd AND tr.verificatie_score >= 0.85) AS gecontroleerde_tracks,
                    COALESCE((SELECT MAX(tr.verificatie_score) FROM tracks tr WHERE tr.titel_id = t.id AND tr.werkt), 0)::float AS beste_score,
                    COALESCE((SELECT SUM(tr.fout_aantal)::int FROM tracks tr WHERE tr.titel_id = t.id), 0) AS afspeelfouten,
                    (SELECT MAX(tr.laatst_gecontroleerd_op) FROM tracks tr WHERE tr.titel_id = t.id) AS laatste_controle,
                    COALESCE((SELECT ARRAY_AGG(DISTINCT tr.bron) FROM tracks tr WHERE tr.titel_id = t.id), '{}') AS bronnen,
                    (SELECT COUNT(*)::int FROM meldingen m WHERE m.titel_id = t.id AND m.afgehandeld = false) AS open_meldingen
              FROM titels t
             WHERE NOT EXISTS (SELECT 1 FROM tracks vc
                                WHERE vc.titel_id = t.id AND vc.werkt
                                  AND vc.bron = 'lokaal'
                                  AND vc.itunes_track_id IS NULL
                                  AND vc.download_status = 'available'
                                  AND vc.gecontroleerd AND vc.verificatie_score >= 0.85)
             ORDER BY t.naam LIMIT 300`),
        ]);
        res.json({
            verificatie: verificatie.rows[0],
            downloads: downloads.rows,
            meldingen: meldingen.rows,
            titels_zonder_gecontroleerde_track: titels.rows,
        });
    } catch (err) {
        res.status(500).json({ fout: `Kwaliteitsdashboard mislukt: ${err.message}` });
    }
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

router.delete('/api/admin/gebruikers/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM auth_sessies WHERE gebruiker_id = $1`, [req.params.id]);
    const { rows } = await pool.query(
        `DELETE FROM gebruikers WHERE id = $1
          RETURNING id, gebruikersnaam`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });
    res.json({ ok: true, gebruiker: rows[0] });
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
    if (!b.preview_url) {
        return res.status(400).json({ fout: 'preview_url verplicht.' });
    }
    const geldigeBron = ['youtube', 'lokaal'].includes(b.bron) ? b.bron : null;
    if (!geldigeBron) return res.status(400).json({ fout: 'Kies expliciet YouTube of lokaal.' });
    if (geldigeBron === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(String(b.preview_url))) {
        return res.status(400).json({ fout: 'YouTube-track heeft geen geldig video-id.' });
    }
    const titelRij = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar, tmdb_id FROM titels WHERE id = $1`,
        [req.params.id],
    );
    if (!titelRij.rows[0]) return res.status(404).json({ fout: 'Titel niet gevonden.' });

    const titel = titelRij.rows[0];
    const tracknaam = String(b.tracknaam || titel.naam || 'Handmatige YouTube-track').trim().slice(0, 300);
    // Een handmatige URL is een expliciete adminbeslissing. De admin heeft
    // het nummer zelf gecontroleerd; automatische titel-/album-/TMDB-
    // matching mag deze invoer dus niet blokkeren.
    const handmatig = b.handmatig === true;
    let controle = geldigeBron === 'lokaal' || handmatig
        ? { past: true, zekerheid: 1, reden: geldigeBron === 'lokaal'
            ? 'handmatig lokaal bestand door admin'
            : 'handmatig door admin gekoppelde YouTube-link' }
        : pastBijTitel(titel, {
            tracknaam,
            album: b.album,
            artiest: b.artiest,
        });
    if (!controle.past) {
        return res.status(422).json({
            fout: `Track afgewezen: ${controle.reden}. Voeg de volledige titel/alias toe aan de tracknaam of het album.`,
        });
    }
    if (geldigeBron !== 'lokaal' && !handmatig) {
        const tmdbControle = await tmdb.controleerTrackMetTmdb(titel, {
            tracknaam,
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
        // Zelf toegevoegd via /admin = bewust gekozen, dus meteen bevestigd
        // én gecontroleerd. Anders zou het spel hem kunnen weigeren.
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             start_seconde, tracknaam, artiest, album,
                             herkenbaarheid, gecontroleerd, bevestigd,
                             verificatie_score, verificatie_reden,
                             laatst_gecontroleerd_op, bron_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, true, $10, $11,
                 now(), $12)
         RETURNING *`,
        [
            req.params.id,
            geldigeBron,
            b.itunes_track_id ?? null,
            b.preview_url,
            Number.isFinite(b.start_seconde) ? b.start_seconde : 0,
            tracknaam,
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
    const download = geldigeBron === 'youtube'
        ? startTrackDownload(rows[0].id, async () => {
            await controleerTrackUrl({ ...rows[0], naam: titel.naam });
            await downloadTrack({ ...rows[0], naam: titel.naam });
            return { ok: true, opgeslagen: true, map: process.env.DOWNLOAD_DIR || '/media/downloads' };
        })
        : null;
    res.json({ ...rows[0], download });
});

router.delete('/api/admin/tracks/:id', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `DELETE FROM tracks WHERE id = $1
          RETURNING id, bron, preview_url, bestand_pad`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Track niet gevonden.' });
    const bestand = await verwijderMediaBestand(rows[0]);
    res.json({ ok: true, bestand });
});

// Exporteer afgekeurde tracks als controlelijst. De admin kan dit bestand
// bewaren, zonder dat er direct data uit de database wordt verwijderd.
router.get('/api/admin/tracks/afgekeurd/export', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT tr.id AS track_id, t.id AS titel_id, t.naam AS titel,
                t.type, t.jaar, tr.bron, tr.tracknaam, tr.artiest,
                tr.bron_url, tr.verificatie_score, tr.verificatie_reden,
                tr.fout_aantal, tr.download_status, tr.download_melding
           FROM tracks tr JOIN titels t ON t.id = tr.titel_id
          WHERE tr.werkt = false
          ORDER BY t.naam, tr.id`,
    );
    res.setHeader('Content-Disposition', 'attachment; filename="ventune-afgekeurde-tracks.json"');
    res.json({ geëxporteerd_op: new Date().toISOString(), tracks: rows });
});

router.post('/api/admin/tracks/:id/download', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, tr.bron_url, tr.tracknaam,
                tr.start_seconde, tr.download_status, tr.itunes_track_id,
                t.naam
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          WHERE tr.id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Track niet gevonden.' });
    if (isAppleTrack(rows[0])) {
        return res.status(400).json({ fout: 'Dit is een iTunes/Apple-preview en geen volledig nummer. Zoek een YouTube-bron of upload volledige audio.' });
    }
    if (!['youtube', 'lokaal'].includes(rows[0].bron)) {
        return res.status(400).json({ fout: 'Alleen YouTube- of herstelbare lokale tracks kunnen vooraf worden gedownload.' });
    }
    const antwoord = startTrackDownload(rows[0].id, async () => {
        await controleerTrackUrl(rows[0]);
        await downloadTrack({ ...rows[0], naam: rows[0].tracknaam || rows[0].naam });
        return { ok: true, opgeslagen: true, map: process.env.DOWNLOAD_DIR || '/media/downloads' };
    });
    res.status(antwoord.gestart ? 202 : 409).json(antwoord);
});

router.get('/api/admin/tracks/:id/download/status', vereisAdmin, (req, res) => {
    const status = trackDownloadStatuses.get(String(req.params.id));
    res.json(status || { bezig: false, klaar: false, samenvatting: null, fout: null });
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
                t.id AS titel_id, t.naam AS titel_naam, t.type AS titel_type, t.jaar AS titel_jaar,
                tr.id AS track_id, tr.bron, tr.preview_url, tr.tracknaam, tr.artiest,
                tr.werkt AS track_werkt, tr.gecontroleerd AS track_gecontroleerd,
                tr.verificatie_score, tr.download_status
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

router.get('/api/admin/meldingen/groepen', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT COALESCE(t.id, 0) AS titel_id,
                COALESCE(t.naam, '(titel weg)') AS titel_naam,
                COUNT(*)::int AS aantal,
                COUNT(*) FILTER (WHERE m.afgehandeld = false)::int AS open,
                MAX(m.aangemaakt_op) AS laatste,
                ARRAY_AGG(DISTINCT m.soort) AS soorten,
                ARRAY_AGG(DISTINCT m.toelichting) FILTER (WHERE m.toelichting IS NOT NULL) AS toelichtingen
           FROM meldingen m LEFT JOIN titels t ON t.id = m.titel_id
          GROUP BY t.id, t.naam
          ORDER BY open DESC, laatste DESC
          LIMIT 300`,
    );
    res.json(rows);
});

// Zoek vanuit een melding opnieuw op YouTube, maar sla nooit automatisch op.
// De admin krijgt dus één kandidaat om te beluisteren en goed te keuren.
router.post('/api/admin/meldingen/:id/zoek', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT t.id, t.naam, t.aliassen, t.type, t.taal, t.jaar, t.tmdb_id
           FROM meldingen m JOIN titels t ON t.id = m.titel_id
          WHERE m.id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Melding of titel niet gevonden.' });
    try {
        const keuze = await ytzoek.zoekVoorTitel(rows[0], { pauzeMs: 100, limiet: 12 });
        if (!keuze) return res.status(404).json({ fout: 'Geen betrouwbare YouTube-match gevonden.' });
        const controle = await tmdb.controleerTrackMetTmdb(rows[0], {
            tracknaam: keuze.titel,
            artiest: keuze.kanaal,
        });
        if (!controle.past) return res.status(422).json({ fout: `Match afgewezen: ${controle.reden}` });
        res.json({
            titel_id: rows[0].id,
            bron: 'youtube',
            preview_url: keuze.videoId,
            tracknaam: keuze.titel,
            artiest: keuze.kanaal || 'YouTube',
            bron_url: `https://www.youtube.com/watch?v=${keuze.videoId}`,
            verificatie_score: keuze._controle?.zekerheid || 0,
            verificatie_reden: `${keuze._controle?.reden || 'YouTube-titelcontrole'}${controle.beschikbaar ? `; ${controle.reden}` : ''}`,
            youtube_url: `https://www.youtube.com/watch?v=${keuze.videoId}`,
        });
    } catch (err) {
        res.status(502).json({ fout: `YouTube zoeken mislukt: ${err.message}` });
    }
});

// Koppel een door de admin gecontroleerde YouTube-kandidaat aan de melding.
// Koppelen is bewust ook goedkeuren: daarna mag de titel direct weer meedoen.
router.post('/api/admin/meldingen/:id/koppel', vereisAdmin, async (req, res) => {
    const kandidaat = req.body?.kandidaat || req.body || {};
    const videoId = String(kandidaat.preview_url || kandidaat.videoId || '').trim();
    const tracknaam = String(kandidaat.tracknaam || kandidaat.titel || '').trim().slice(0, 300);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !tracknaam) {
        return res.status(400).json({ fout: 'Kies eerst een geldige YouTube-kandidaat.' });
    }
    const meldingRij = await pool.query(
        `SELECT m.id, m.titel_id, m.track_id,
                t.naam, t.aliassen, t.type, t.taal, t.jaar, t.tmdb_id
           FROM meldingen m JOIN titels t ON t.id = m.titel_id
          WHERE m.id = $1`,
        [req.params.id],
    );
    if (!meldingRij.rows[0]) return res.status(404).json({ fout: 'Melding of titel niet gevonden.' });
    const melding = meldingRij.rows[0];
    const trackGegevens = {
        tracknaam,
        album: kandidaat.album,
        artiest: String(kandidaat.artiest || kandidaat.kanaal || 'YouTube').slice(0, 300),
    };
    const titelControle = pastBijTitel(melding, trackGegevens);
    if (!titelControle.past) return res.status(422).json({ fout: `Koppeling afgewezen: ${titelControle.reden}` });
    const tmdbControle = await tmdb.controleerTrackMetTmdb(melding, trackGegevens);
    if (!tmdbControle.past) return res.status(422).json({ fout: `Koppeling afgewezen door TMDB: ${tmdbControle.reden}` });

    const reden = [
        kandidaat.verificatie_reden || kandidaat._controle?.reden || 'YouTube-kandidaat gecontroleerd',
        tmdbControle.beschikbaar ? tmdbControle.reden : null,
        'handmatig gekoppeld en goedgekeurd vanuit melding',
    ].filter(Boolean).join('; ');
    const bestaande = await pool.query(
        `SELECT id FROM tracks WHERE titel_id = $1 AND bron = 'youtube' AND preview_url = $2 LIMIT 1`,
        [melding.titel_id, videoId],
    );
    let track;
    if (bestaande.rows[0]) {
        ({ rows: [track] } = await pool.query(
            `UPDATE tracks SET werkt = true, fout_aantal = 0, gecontroleerd = true,
                    verificatie_score = 1, verificatie_reden = $2,
                    laatst_gecontroleerd_op = now(), tracknaam = $3, artiest = $4,
                    bron_url = $5, start_seconde = $6
              WHERE id = $1 RETURNING *`,
            [bestaande.rows[0].id, reden, tracknaam, trackGegevens.artiest,
                kandidaat.bron_url || `https://www.youtube.com/watch?v=${videoId}`,
                Math.max(0, Number(kandidaat.start_seconde) || 0)],
        ));
    } else {
        ({ rows: [track] } = await pool.query(
            `INSERT INTO tracks
                (titel_id, bron, preview_url, start_seconde, tracknaam, artiest,
                 herkenbaarheid, gecontroleerd, verificatie_score, verificatie_reden,
                 laatst_gecontroleerd_op, bron_url)
             VALUES ($1, 'youtube', $2, $3, $4, $5, 5, true, 1, $6, now(), $7)
             RETURNING *`,
            [melding.titel_id, videoId, Math.max(0, Number(kandidaat.start_seconde) || 0),
                tracknaam, trackGegevens.artiest, reden,
                kandidaat.bron_url || `https://www.youtube.com/watch?v=${videoId}`],
        ));
    }
    // Bewaar de gemelde oude track voor audit, maar speel hem niet opnieuw.
    if (melding.track_id && Number(melding.track_id) !== Number(track.id)) {
        await pool.query(
            `UPDATE tracks SET werkt = false, fout_aantal = fout_aantal + 1,
                    verificatie_reden = COALESCE(verificatie_reden, '') || ' | vervangen vanuit melding'
              WHERE id = $1`,
            [melding.track_id],
        );
    }
    await pool.query(`UPDATE meldingen SET track_id = $2, afgehandeld = true WHERE id = $1`, [req.params.id, track.id]);
    const download = startTrackDownload(track.id, async () => {
        await controleerTrackUrl({ ...track, naam: tracknaam });
        await downloadTrack({ ...track, naam: tracknaam });
        return { ok: true, opgeslagen: true, map: process.env.DOWNLOAD_DIR || '/media/downloads' };
    });
    res.json({ ok: true, track, download, melding_id: Number(req.params.id) });
});

// Markeer een bestaande track als door de admin goedgekeurd. Hierdoor wordt
// ook een foutmelding die eraan gekoppeld is opgelost en doet de titel weer mee.
router.post('/api/admin/meldingen/:id/goedkeuren', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT m.id, m.titel_id, m.track_id FROM meldingen m WHERE m.id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Melding niet gevonden.' });
    const trackId = req.body?.track_id || rows[0].track_id;
    if (!trackId) return res.status(400).json({ fout: 'Deze melding heeft geen gekoppelde track. Zoek eerst een YouTube-kandidaat.' });
    const trackRij = await pool.query(
        `UPDATE tracks SET werkt = true, fout_aantal = 0, gecontroleerd = true,
                verificatie_score = 1, verificatie_reden = 'handmatig goedgekeurd vanuit melding',
                laatst_gecontroleerd_op = now()
          WHERE id = $1 AND titel_id = $2 RETURNING *`,
        [trackId, rows[0].titel_id],
    );
    if (!trackRij.rows[0]) return res.status(404).json({ fout: 'Gekoppelde track niet gevonden bij deze titel.' });
    await pool.query(`UPDATE meldingen SET afgehandeld = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, track: trackRij.rows[0] });
});

router.post('/api/admin/meldingen/:id/afgehandeld', vereisAdmin, async (req, res) => {
    await pool.query(`UPDATE meldingen SET afgehandeld = true WHERE id = $1`, [
        req.params.id,
    ]);
    res.json({ ok: true });
});

// Opgeloste meldingen mogen expliciet worden verwijderd. Open meldingen
// blijven beschermd tegen een vergissing; eerst afhandelen, daarna wissen.
router.delete('/api/admin/meldingen/:id', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `DELETE FROM meldingen
          WHERE id = $1 AND afgehandeld = true
          RETURNING id`,
        [req.params.id],
    );
    if (!rows[0]) {
        return res.status(409).json({ fout: 'Melding eerst als afgehandeld markeren.' });
    }
    res.json({ ok: true, id: rows[0].id });
});

// ---- Seed importeren (YouTube als enige automatische audiobron) ----
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
let catalogusImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let studioImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let vragenImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let downloadStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let lokaleAanvullingStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let mediaHealthStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
let collectieImportStatus = { bezig: false, klaar: false, samenvatting: null, fout: null };
const trackDownloadStatuses = new Map();
// Imports wijzigen dezelfde vragenbank. Eén gedeelde lock voorkomt dat twee
// admins (of twee browservensters) tegelijk tracks/titels gaan vervangen.
let actieveAdminTaak = null;
// Stoppen gebeurt coöperatief: de huidige netwerkactie mag afronden,
// daarna verlaten de batch-workers hun taak vóór de volgende actie.
let stopAangevraagdVoor = null;

const ADMIN_TAAK_LABELS = {
    seed: 'Database aanvullen met ontbrekende tracks',
    playlists: 'YouTube-playlists verversen',
    tmdb: 'TMDB-films en series ophalen',
    'tmdb-catalogus': 'Populaire films/series per jaar + NL top 10 + Cult Classics',
    studio: 'Ontbrekende studio’s via TMDB aanvullen',
    vragen: 'Bonusvragen genereren',
    downloads: 'MP3’s vooraf downloaden',
    'lokale-aanvulling': 'Ontbrekende lokale MP3’s zoeken en downloaden',
    'downloads-retry': 'Mislukte downloads opnieuw proberen',
    'media-health': 'Lokale bestanden controleren',
    collecties: 'Spelcollecties importeren',
    'media-health-auto': 'Dagelijkse bestandscontrole',
    'playlists-auto': 'Dagelijkse playlist-refresh',
    'tmdb-auto': 'Dagelijkse TMDB-update',
    'seed-auto': 'Dagelijkse YouTube-aanvulling',
    'downloads-auto': 'Dagelijkse goedgekeurde downloads',
};

function adminTaakLijst() {
    const statussen = {
        seed: seedStatus,
        playlists: playlistImportStatus,
        tmdb: tmdbImportStatus,
        'tmdb-catalogus': catalogusImportStatus,
        studio: studioImportStatus,
        vragen: vragenImportStatus,
        downloads: downloadStatus,
        'lokale-aanvulling': lokaleAanvullingStatus,
        'downloads-retry': downloadStatus,
        'media-health': mediaHealthStatus,
        collecties: collectieImportStatus,
        'media-health-auto': mediaHealthStatus,
        'playlists-auto': playlistImportStatus,
        'tmdb-auto': tmdbImportStatus,
        'seed-auto': seedStatus,
        'downloads-auto': downloadStatus,
    };
    return Object.entries(statussen).map(([naam, status]) => ({
        naam,
        label: ADMIN_TAAK_LABELS[naam] || naam,
        actief: actieveAdminTaak === naam,
        status: status || { bezig: false, klaar: false },
    }));
}

router.get('/api/admin/taken', vereisAdmin, (_req, res) => {
    res.json({ actieve_taak: actieveAdminTaak, taken: adminTaakLijst() });
});

function adminStatusVoorTaak(naam) {
    return adminTaakLijst().find((taak) => taak.naam === naam)?.status || null;
}

router.post('/api/admin/taken/:taak/stop', vereisAdmin, (req, res) => {
    const taak = String(req.params.taak || '').trim();
    if (!taak || actieveAdminTaak !== taak) {
        return res.status(409).json({ fout: 'Deze admin-taak draait niet meer.' });
    }
    stopAangevraagdVoor = taak;
    const status = adminStatusVoorTaak(taak);
    if (status) {
        status.stop_aangevraagd = true;
        status.stop_melding = 'Stop aangevraagd; de huidige actie wordt afgerond.';
    }
    res.json({ ok: true, taak, melding: 'Stop aangevraagd.' });
});

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
        stop_aangevraagd: false,
    };
    actieveAdminTaak = naam;
    stopAangevraagdVoor = null;
    setter(nieuw);
    const isGeannuleerd = () => actieveAdminTaak === naam && stopAangevraagdVoor === naam;
    Promise.resolve()
        .then(() => werk({ isGeannuleerd }))
        .then((samenvatting) => {
            const gestopt = stopAangevraagdVoor === naam
                || Boolean(samenvatting?.geannuleerd)
                || Boolean(samenvatting?.gestopt);
            setter({
                ...nieuw,
                bezig: false,
                klaar: true,
                gestopt,
                stop_aangevraagd: false,
                samenvatting,
            });
        })
        .catch((err) => {
            setter({ ...nieuw, bezig: false, klaar: true, fout: err.message, stop_aangevraagd: false });
            logger.fout(`Admin-taak mislukt: ${naam}.`, { melding: err.message });
        })
        .finally(() => {
            if (actieveAdminTaak === naam) actieveAdminTaak = null;
            if (stopAangevraagdVoor === naam) stopAangevraagdVoor = null;
        });
    return { gestart: true, bezig: true, taak: naam };
}

function startTrackDownload(trackId, werk) {
    const sleutel = String(trackId);
    const bestaand = trackDownloadStatuses.get(sleutel);
    if (actieveAdminTaak || bestaand?.bezig) {
        return {
            gestart: false,
            bezig: true,
            taak: actieveAdminTaak || `track-download-${sleutel}`,
        };
    }
    const nieuw = {
        bezig: true,
        klaar: false,
        gestart_op: new Date().toISOString(),
        samenvatting: null,
        fout: null,
    };
    trackDownloadStatuses.set(sleutel, nieuw);
    const taak = `track-download-${sleutel}`;
    actieveAdminTaak = taak;
    Promise.resolve()
        .then(werk)
        .then((samenvatting) => {
            trackDownloadStatuses.set(sleutel, { ...nieuw, bezig: false, klaar: true, samenvatting });
        })
        .catch((err) => {
            trackDownloadStatuses.set(sleutel, { ...nieuw, bezig: false, klaar: true, fout: err.message });
            logger.fout(`Losse trackdownload mislukt: ${sleutel}.`, { melding: err.message });
        })
        .finally(() => {
            if (actieveAdminTaak === taak) actieveAdminTaak = null;
        });
    return { gestart: true, bezig: true, klaar: false, taak, track_id: Number(trackId) };
}

async function downloadTracksVooruit({ collecties = [], force = false, controleer = true, alleenMislukt = false, alleenGecontroleerd = false, alleenYoutube = true, alleenZonderLokaal = false, limiet = null, onProgress = null, batchGrootte: opgegevenBatchGrootte = null, isGeannuleerd = () => false } = {}) {
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
    params.push(alleenMislukt);
    const mislukteParam = params.length;
    params.push(alleenGecontroleerd);
    const gecontroleerdeParam = params.length;
    params.push(alleenYoutube);
    const youtubeParam = params.length;
    params.push(alleenZonderLokaal);
    const zonderLokaalParam = params.length;
    const batchLimiet = limiet !== null && limiet !== undefined && limiet !== '' && Number.isFinite(Number(limiet))
        ? Math.max(1, Math.floor(Number(limiet)))
        : null;
    if (batchLimiet) params.push(batchLimiet);
    const limietParam = batchLimiet ? params.length : null;
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, tr.bron_url, tr.tracknaam,
                tr.start_seconde, tr.download_status, t.naam
           FROM tracks tr JOIN titels t ON t.id = tr.titel_id
          WHERE tr.werkt = true
            AND (
                tr.bron = 'youtube'
                OR (tr.bron = 'lokaal'
                    AND tr.download_status = 'failed'
                    AND lower(COALESCE(tr.bron_url, '')) LIKE '%youtube%')
            )
            AND tr.preview_url IS NOT NULL AND tr.preview_url <> ''
            AND ($${mislukteParam}::boolean = false OR tr.download_status = 'failed')
            AND ($${gecontroleerdeParam}::boolean = false OR (tr.gecontroleerd = true AND tr.verificatie_score >= 0.85))
            AND ($${youtubeParam}::boolean = false OR tr.bron = 'youtube'
                 OR (tr.bron = 'lokaal' AND lower(COALESCE(tr.bron_url, '')) LIKE '%youtube%'))
            AND ($${zonderLokaalParam}::boolean = false OR NOT EXISTS (
                SELECT 1 FROM tracks lokaal
                 WHERE lokaal.titel_id = tr.titel_id
                   AND lokaal.bron = 'lokaal'
                   AND lokaal.itunes_track_id IS NULL
                   AND lokaal.werkt = true
                   AND lokaal.download_status = 'available'
            ))
            ${extra}
          ORDER BY CASE tr.download_status
                     WHEN 'not_requested' THEN 0
                     WHEN 'failed' THEN 1
                     ELSE 2
                   END,
                   tr.id
          ${limietParam ? `LIMIT $${limietParam}` : ''}`,
        params,
    );
    let gedownload = 0;
    let overgeslagen = 0;
    let mislukt = 0;
    const fouten = [];
    let ingesteldeBatch = Number(opgegevenBatchGrootte);
    if (!Number.isFinite(ingesteldeBatch) || ingesteldeBatch < 1) {
        try {
            ingesteldeBatch = Number((await haalBeheerInstellingen()).batchGrootte);
        } catch {
            ingesteldeBatch = DEFAULT_BATCH_GROOTTE;
        }
    }
    const batchGrootte = begrensBatchGrootte(ingesteldeBatch);
    let verwerkt = 0;
    let geannuleerd = false;
    for (let start = 0; start < rows.length; start += batchGrootte) {
        if (isGeannuleerd()) {
            geannuleerd = true;
            break;
        }
        const batch = rows.slice(start, start + batchGrootte);
        await Promise.all(batch.map(async (track) => {
            if (isGeannuleerd()) {
                geannuleerd = true;
                return;
            }
            // Een download is permanent lokaal bezit. Ook bij force=true mag de
            // oorspronkelijke URL dan niet opnieuw worden gecontroleerd.
            if (track.download_status === 'available') {
                overgeslagen++;
            } else {
                try {
                    if (isGeannuleerd()) {
                        geannuleerd = true;
                        return;
                    }
                    if (controleer) await controleerTrackUrl(track);
                    if (isGeannuleerd()) {
                        geannuleerd = true;
                        return;
                    }
                    await downloadTrack(track);
                    gedownload++;
                } catch (err) {
                    mislukt++;
                    fouten.push({ id: track.id, naam: track.naam, fout: err.message });
                    await pool.query(
                        'UPDATE tracks SET download_status = \'failed\', download_melding = $2 WHERE id = $1',
                        [track.id, String(err.message).slice(0, 500)],
                    ).catch(() => {});
                }
            }
            verwerkt++;
            onProgress?.({ verwerkt, totaal: rows.length, huidige: track.naam, overgeslagen, gedownload, mislukt });
        }));
    }
    return {
        verwerkt,
        geannuleerd,
        gedownload,
        overgeslagen,
        mislukt,
        fouten: fouten.slice(0, 100),
        map: process.env.DOWNLOAD_DIR || '/media/downloads',
    };
}

// Eén herstelactie voor de databasefilter “zonder lokale MP3”: eerst alleen
// die titels op YouTube zoeken, daarna de nieuwe kandidaten meteen lokaal
// opslaan. Titels met een beschikbare lokale track worden in beide stappen
// overgeslagen.
router.post('/api/admin/ontbrekende-lokale/start', vereisAdmin, (req, res) => {
    // Zoeken blijft een batch: YouTube knijpt af bij te veel verzoeken.
    // Downloaden hoeft dat niet — dat is puur je eigen server. Standaard
    // wordt daarom álles gedownload waarvoor al een kandidaat klaarstaat.
    const zoekLimiet = Math.min(1000, Math.max(1, Number(req.body?.limiet) || 250));
    const alleenDownloaden = req.body?.alleen_downloaden === true;
    const downloadLimiet = Number(req.body?.download_limiet) > 0
        ? Math.floor(Number(req.body.download_limiet))
        : null;
    const antwoord = startAdminScript(
        'lokale-aanvulling',
        lokaleAanvullingStatus,
        (v) => { lokaleAanvullingStatus = v; },
        async ({ isGeannuleerd = () => false } = {}) => {
            // Stap 1: zoeken. Titels die eerder niets opleverden staan in de
            // wachtrij achteraan, dus elke run pakt nieuwe titels op.
            const importSamenvatting = alleenDownloaden
                ? { overgeslagen: true }
                : await importeer({
                    force: false,
                    alleenDb: true,
                    youtubeAlleen: true,
                    alleenZonderLokaal: true,
                    limiet: zoekLimiet,
                    opnieuwProberen: req.body?.opnieuw === true,
                    onProgress: (voortgang) => {
                        lokaleAanvullingStatus = { ...lokaleAanvullingStatus, stap: 'zoeken', ...voortgang };
                    },
                    isGeannuleerd,
                });
            // Stap 2: alles wat een kandidaat heeft lokaal opslaan.
            const downloadSamenvatting = isGeannuleerd()
                ? { geannuleerd: true, overgeslagen: true }
                : await downloadTracksVooruit({
                alleenYoutube: true,
                alleenZonderLokaal: true,
                controleer: true,
                limiet: downloadLimiet,
                onProgress: (voortgang) => {
                    lokaleAanvullingStatus = { ...lokaleAanvullingStatus, stap: 'downloaden', ...voortgang };
                },
                isGeannuleerd,
            });
            return { import: importSamenvatting, downloads: downloadSamenvatting };
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/ontbrekende-lokale/status', vereisAdmin, (_req, res) => {
    res.json(lokaleAanvullingStatus);
});

router.post('/api/admin/downloads/start', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'downloads',
        downloadStatus,
        (v) => { downloadStatus = v; },
        async ({ isGeannuleerd = () => false } = {}) => {
            const collecties = Array.isArray(req.body?.collecties) ? req.body.collecties : [];
            logger.info('Vooraf downloaden gestart via admin.', { collecties });
            return downloadTracksVooruit({
                collecties,
                force: req.body?.force === true,
                controleer: req.body?.controleer !== false,
                alleenMislukt: req.body?.alleenMislukt === true,
                alleenGecontroleerd: req.body?.alleenGecontroleerd === true,
                alleenYoutube: req.body?.alleenYoutube !== false,
                alleenZonderLokaal: req.body?.alleenZonderLokaal === true,
                onProgress: (voortgang) => { downloadStatus = { ...downloadStatus, ...voortgang }; },
                isGeannuleerd,
            });
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/downloads/status', vereisAdmin, (_req, res) => {
    res.json(downloadStatus);
});

// ---- Zoekwachtrij: wat is er vastgelopen en waarom? ----
router.get('/api/admin/zoekwachtrij', vereisAdmin, async (req, res) => {
    const limiet = Math.min(200, Math.max(1, Number(req.query?.limiet) || 50));
    try {
        const { rows } = await pool.query(
            `SELECT t.id, t.naam, t.jaar, t.type, t.taal,
                    t.zoek_status, t.zoek_pogingen, t.zoek_melding,
                    t.laatste_zoekpoging, t.volgende_poging
               FROM titels t
              WHERE t.zoek_status IN ('geen_kandidaat', 'opgegeven')
                AND NOT EXISTS (SELECT 1 FROM tracks x
                                 WHERE x.titel_id = t.id AND x.werkt
                                   AND x.preview_url IS NOT NULL AND x.preview_url <> '')
              ORDER BY t.zoek_pogingen DESC, t.laatste_zoekpoging DESC NULLS LAST
              LIMIT $1`,
            [limiet],
        );
        res.json(rows);
    } catch (err) {
        logger.waarschuwing('Zoekwachtrij opvragen mislukt.', { melding: err.message });
        res.json([]);
    }
});

/**
 * Opgegeven titels terugzetten in de wachtrij. Zonder deze knop zou een
 * titel die vijf keer niets opleverde voorgoed buiten beeld blijven.
 * Met `alles` gaan ook de wachtende titels meteen weer mee.
 */
// Meldingen die op een storing wijzen in plaats van op een titel zonder
// muziek. Zulke titels horen niet in de vastgelopen-lijst thuis.
const STORINGSMELDINGEN = [
    '%fetch failed%', '%niet bereikbaar%', '%ECONNRESET%', '%ETIMEDOUT%',
    '%ENOTFOUND%', '%EAI_AGAIN%', '%socket hang up%',
    '%status 429%', '%status 403%', '%timeout%',
];

router.post('/api/admin/zoekwachtrij/opnieuw', vereisAdmin, async (req, res) => {
    const alles = req.body?.alles === true;
    const titelId = Number(req.body?.titel_id) || null;

    // Alleen de titels die door een storing zijn afgekeurd terugzetten.
    if (req.body?.alleen_storingen === true) {
        try {
            const { rowCount } = await pool.query(
                `UPDATE titels
                    SET zoek_status = 'nieuw', zoek_pogingen = 0,
                        volgende_poging = NULL, zoek_melding = NULL
                  WHERE zoek_status IN ('geen_kandidaat', 'opgegeven')
                    AND zoek_melding ILIKE ANY($1::text[])`,
                [STORINGSMELDINGEN],
            );
            return res.json({ ok: true, hersteld: rowCount });
        } catch (err) {
            logger.waarschuwing('Storingen herstellen mislukt.', { melding: err.message });
            return res.status(500).json({ fout: err.message });
        }
    }

    try {
        const { rowCount } = await pool.query(
            `UPDATE titels
                SET zoek_status = 'nieuw',
                    zoek_pogingen = 0,
                    volgende_poging = NULL,
                    zoek_melding = NULL
              WHERE ($1::int IS NULL OR id = $1)
                AND ($1::int IS NOT NULL
                     OR zoek_status = 'opgegeven'
                     OR ($2::boolean = true AND volgende_poging IS NOT NULL))`,
            [titelId, alles],
        );
        res.json({ ok: true, hersteld: rowCount });
    } catch (err) {
        logger.waarschuwing('Zoekwachtrij herstellen mislukt.', { melding: err.message });
        res.status(500).json({ fout: err.message });
    }
});

router.post('/api/admin/downloads/retry-mislukt', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'downloads-retry',
        downloadStatus,
        (v) => { downloadStatus = v; },
        async ({ isGeannuleerd = () => false } = {}) => downloadTracksVooruit({
            alleenMislukt: true,
            controleer: true,
            onProgress: (voortgang) => { downloadStatus = { ...downloadStatus, ...voortgang }; },
            isGeannuleerd,
        }),
    );
    res.json(antwoord);
});

router.post('/api/admin/media-health/start', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'media-health',
        mediaHealthStatus,
        (v) => { mediaHealthStatus = v; },
        async () => controleerLokaleBestanden({
            onProgress: (voortgang) => { mediaHealthStatus = { ...mediaHealthStatus, ...voortgang }; },
        }),
    );
    res.json(antwoord);
});

router.get('/api/admin/media-health/status', vereisAdmin, (_req, res) => {
    res.json(mediaHealthStatus);
});

router.post('/api/admin/collecties/import', vereisAdmin, (req, res) => {
    const collecties = normaliseerCollecties(req.body?.collecties);
    if (!collecties.length) return res.status(400).json({ fout: 'Kies minimaal één collectie.' });
    const antwoord = startAdminScript(
        'collecties',
        collectieImportStatus,
        (v) => { collectieImportStatus = v; },
        async ({ isGeannuleerd = () => false } = {}) => {
            const imports = [];
            for (const collectie of collecties) {
                if (isGeannuleerd()) return { geannuleerd: true, imports, downloads: null };
                imports.push({ collectie, resultaat: await importeer({ collectie, force: true, isGeannuleerd }) });
            }
            const downloads = req.body?.download === false || isGeannuleerd()
                ? (isGeannuleerd() ? { geannuleerd: true } : null)
                : await downloadTracksVooruit({ collecties, controleer: true, isGeannuleerd });
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
        async ({ isGeannuleerd = () => false } = {}) => {
            logger.info('Seed-import gestart via admin (YouTube als enige automatische audiobron).');
            const samenvatting = await importeer({
                force,
                alleenDb: !!(req.body && req.body.alleenDb),
                youtubeAlleen: !!(req.body && req.body.youtubeAlleen),
                // Admin-imports zijn hervatbare batches. De database blijft
                // leidend; een klik mag nooit duizenden titels opnieuw door
                // de zoekstroom sturen.
                limiet: Math.min(250, Math.max(1, Number(req.body?.limiet) || 250)),
                onProgress: (voortgang) => { seedStatus = { ...seedStatus, ...voortgang }; },
                isGeannuleerd,
            });
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

async function haalBeheerInstellingen() {
    const standaard = {
        playlistAutomatisch: false,
        playlistIntervalUren: 24,
        playlistLaatsteRun: null,
        playlistVolgendeRun: null,
        mediaHealthAutomatisch: true,
        mediaHealthIntervalUren: 24,
        mediaHealthLaatsteRun: null,
        mediaHealthVolgendeRun: null,
        tmdbAutomatisch: true,
        tmdbIntervalUren: 24,
        tmdbLaatsteRun: null,
        tmdbVolgendeRun: null,
        youtubeAutomatisch: true,
        youtubeIntervalUren: 24,
        youtubeLaatsteRun: null,
        youtubeVolgendeRun: null,
        downloadsAutomatisch: true,
        downloadsIntervalUren: 24,
        downloadsLaatsteRun: null,
        downloadsVolgendeRun: null,
        batchGrootte: DEFAULT_BATCH_GROOTTE,
    };
    const { rows } = await pool.query(
        `SELECT waarde FROM app_instellingen WHERE sleutel = 'beheer' LIMIT 1`,
    );
    const waarde = rows[0]?.waarde || {};
    return { ...standaard, ...waarde, batchGrootte: begrensBatchGrootte(waarde.batchGrootte) };
}

router.get('/api/admin/planning', vereisAdmin, async (_req, res) => {
    res.json(await haalBeheerInstellingen());
});

router.patch('/api/admin/planning', vereisAdmin, async (req, res) => {
    const oud = await haalBeheerInstellingen();
    const aan = req.body?.playlistAutomatisch === undefined
        ? oud.playlistAutomatisch === true : req.body.playlistAutomatisch === true;
    const interval = Math.min(168, Math.max(1, Number(req.body?.playlistIntervalUren ?? oud.playlistIntervalUren) || 24));
    const healthAan = req.body?.mediaHealthAutomatisch === undefined
        ? oud.mediaHealthAutomatisch !== false
        : req.body.mediaHealthAutomatisch === true;
    const healthInterval = Math.min(168, Math.max(1, Number(req.body?.mediaHealthIntervalUren ?? oud.mediaHealthIntervalUren) || 24));
    const tmdbAan = req.body?.tmdbAutomatisch === undefined
        ? oud.tmdbAutomatisch === true : req.body.tmdbAutomatisch === true;
    const tmdbInterval = Math.min(168, Math.max(1, Number(req.body?.tmdbIntervalUren ?? oud.tmdbIntervalUren) || 24));
    const youtubeAan = req.body?.youtubeAutomatisch === undefined
        ? oud.youtubeAutomatisch === true : req.body.youtubeAutomatisch === true;
    const youtubeInterval = Math.min(168, Math.max(1, Number(req.body?.youtubeIntervalUren ?? oud.youtubeIntervalUren) || 24));
    const downloadsAan = req.body?.downloadsAutomatisch === undefined
        ? oud.downloadsAutomatisch === true : req.body.downloadsAutomatisch === true;
    const downloadsInterval = Math.min(168, Math.max(1, Number(req.body?.downloadsIntervalUren ?? oud.downloadsIntervalUren) || 24));
    const batchGrootte = begrensBatchGrootte(req.body?.batchGrootte ?? oud.batchGrootte);
    const volgende = aan
        ? new Date(Date.now() + interval * 60 * 60 * 1000).toISOString()
        : null;
    const nieuw = {
        ...oud,
        playlistAutomatisch: aan,
        playlistIntervalUren: interval,
        playlistVolgendeRun: volgende,
        mediaHealthAutomatisch: healthAan,
        mediaHealthIntervalUren: healthInterval,
        mediaHealthVolgendeRun: healthAan
            ? new Date(Date.now() + healthInterval * 60 * 60 * 1000).toISOString()
            : null,
        tmdbAutomatisch: tmdbAan,
        tmdbIntervalUren: tmdbInterval,
        tmdbVolgendeRun: tmdbAan
            ? new Date(Date.now() + tmdbInterval * 60 * 60 * 1000).toISOString()
            : null,
        youtubeAutomatisch: youtubeAan,
        youtubeIntervalUren: youtubeInterval,
        youtubeVolgendeRun: youtubeAan
            ? new Date(Date.now() + youtubeInterval * 60 * 60 * 1000).toISOString()
            : null,
        downloadsAutomatisch: downloadsAan,
        downloadsIntervalUren: downloadsInterval,
        downloadsVolgendeRun: downloadsAan
            ? new Date(Date.now() + downloadsInterval * 60 * 60 * 1000).toISOString()
            : null,
        batchGrootte,
    };
    await pool.query(
        `INSERT INTO app_instellingen (sleutel, waarde, bijgewerkt_op)
         VALUES ('beheer', $1::jsonb, now())
         ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt_op = now()`,
        [JSON.stringify(nieuw)],
    );
    res.json(nieuw);
});

// Voorbeeld vóór een import: alleen de lokale seed wordt vergeleken, er wordt
// niets gewijzigd en er is geen netwerkverzoek nodig.
router.get('/api/admin/import/preview', vereisAdmin, async (_req, res) => {
    try {
        const bestanden = ['titels.json', 'titels-extra.json'];
        const catalogus = bestanden.flatMap((bestand) => {
            try { return JSON.parse(require('fs').readFileSync(path.join(__dirname, '../../seed', bestand), 'utf8')); }
            catch (err) { return err.code === 'ENOENT' ? [] : (() => { throw err; })(); }
        });
        const { rows: bestaand } = await pool.query(`SELECT id, naam, jaar, type, taal FROM titels`);
        const index = new Map(bestaand.map((t) => [`${t.naam.toLowerCase()}|${t.jaar || 0}`, t]));
        const wijzigingen = catalogus.map((t) => {
            const oud = index.get(`${String(t.naam).toLowerCase()}|${t.jaar || 0}`);
            if (!oud) return { actie: 'nieuw', naam: t.naam, jaar: t.jaar || null, type: t.type };
            const verschil = oud.type !== t.type || oud.taal !== t.taal;
            return { actie: verschil ? 'bijwerken' : 'behouden', naam: t.naam, jaar: t.jaar || null, type: t.type };
        });
        res.json({ totaal: wijzigingen.length, nieuw: wijzigingen.filter((x) => x.actie === 'nieuw').length, bijwerken: wijzigingen.filter((x) => x.actie === 'bijwerken').length, behouden: wijzigingen.filter((x) => x.actie === 'behouden').length, items: wijzigingen.slice(0, 200) });
    } catch (err) {
        res.status(500).json({ fout: `Importpreview mislukt: ${err.message}` });
    }
});

router.post('/api/admin/tmdb/import', vereisAdmin, (req, res) => {
    const type = ['film', 'serie', 'beide'].includes(req.body?.type) ? req.body.type : 'beide';
    const genre = String(req.body?.genre || '').trim().slice(0, 40);
    const antwoord = startAdminScript(
        'tmdb',
        tmdbImportStatus,
        (v) => { tmdbImportStatus = v; },
        () => importeerTmdb({ type, genre }),
    );
    res.json(antwoord);
});

router.get('/api/admin/tmdb/status', vereisAdmin, (_req, res) => {
    res.json(tmdbImportStatus);
});

// Grote catalogusimport: alleen titels/metadata. YouTube zoeken en MP3's
// downloaden blijven afzonderlijke taken, zodat beide hervatbaar zijn.
router.post('/api/admin/tmdb/catalogus', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'tmdb-catalogus',
        catalogusImportStatus,
        (v) => { catalogusImportStatus = v; },
        () => importeerJaarCatalogus({
            startJaar: 1980,
            eindJaar: new Date().getUTCFullYear(),
            opProgress: (voortgang) => { catalogusImportStatus = { ...catalogusImportStatus, ...voortgang }; },
        }),
    );
    res.json(antwoord);
});

router.get('/api/admin/tmdb/catalogus/status', vereisAdmin, (_req, res) => {
    res.json(catalogusImportStatus);
});

// Studio/producent is een apart verrijkingsproces. Zo kun je later Disney,
// Pixar of Marvel als collectie gebruiken zonder bij iedere import opnieuw
// alle TMDB-details op te halen.
router.post('/api/admin/studio/import', vereisAdmin, (req, res) => {
    const antwoord = startAdminScript(
        'studio',
        studioImportStatus,
        (v) => { studioImportStatus = v; },
        async () => {
            const limiet = Math.min(1000, Math.max(1, Number(req.body?.limiet) || 250));
            const { rows } = await pool.query(
                `SELECT id, naam, type, tmdb_id
                   FROM titels
                  WHERE tmdb_id IS NOT NULL AND NULLIF(BTRIM(studio), '') IS NULL
                  ORDER BY id
                  LIMIT $1`,
                [limiet],
            );
            let aangevuld = 0;
            let overgeslagen = 0;
            for (const [index, titel] of rows.entries()) {
                studioImportStatus = { ...studioImportStatus, verwerkt: index, totaal: rows.length, huidige: titel.naam };
                try {
                    const details = await tmdb.haalDetails(titel.tmdb_id, titel.type);
                    if (!details.studio) { overgeslagen++; continue; }
                    await pool.query(`UPDATE titels SET studio = $2 WHERE id = $1`, [titel.id, details.studio]);
                    aangevuld++;
                } catch (err) {
                    overgeslagen++;
                    logger.waarschuwing('Studio kon niet worden aangevuld.', { titel: titel.naam, melding: err.message });
                }
                studioImportStatus = { ...studioImportStatus, verwerkt: index + 1, totaal: rows.length, huidige: titel.naam };
            }
            return { verwerkt: rows.length, aangevuld, overgeslagen };
        },
    );
    res.json(antwoord);
});

router.get('/api/admin/studio/status', vereisAdmin, (_req, res) => {
    res.json(studioImportStatus);
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

// Periodieke beheerupdates. Elke soort is afzonderlijk instelbaar vanuit de
// admin; de timer blijft licht en unref'ed zodat hij afsluiten niet blokkeert.
let playlistPlannerTimer = null;
function startPlaylistPlanner() {
    if (playlistPlannerTimer) return;
    playlistPlannerTimer = setInterval(async () => {
        try {
            const beheer = await haalBeheerInstellingen();
            if (actieveAdminTaak) return;
            const nu = Date.now();
            const plannen = [
                {
                    aan: beheer.mediaHealthAutomatisch !== false,
                    interval: 'mediaHealthIntervalUren',
                    volgende: 'mediaHealthVolgendeRun',
                    laatste: 'mediaHealthLaatsteRun',
                    taak: 'media-health-auto',
                    status: mediaHealthStatus,
                    zetStatus: (v) => { mediaHealthStatus = v; },
                    werk: () => controleerLokaleBestanden(),
                },
                {
                    aan: beheer.playlistAutomatisch === true,
                    interval: 'playlistIntervalUren',
                    volgende: 'playlistVolgendeRun',
                    laatste: 'playlistLaatsteRun',
                    taak: 'playlists-auto',
                    status: playlistImportStatus,
                    zetStatus: (v) => { playlistImportStatus = v; },
                    werk: () => importeerPlaylists({}),
                },
                {
                    aan: beheer.tmdbAutomatisch === true,
                    interval: 'tmdbIntervalUren',
                    volgende: 'tmdbVolgendeRun',
                    laatste: 'tmdbLaatsteRun',
                    taak: 'tmdb-auto',
                    status: tmdbImportStatus,
                    zetStatus: (v) => { tmdbImportStatus = v; },
                    werk: () => importeerTmdb({ type: 'beide' }),
                },
                {
                    aan: beheer.youtubeAutomatisch === true,
                    interval: 'youtubeIntervalUren',
                    volgende: 'youtubeVolgendeRun',
                    laatste: 'youtubeLaatsteRun',
                    taak: 'seed-auto',
                    status: seedStatus,
                    zetStatus: (v) => { seedStatus = v; },
                    werk: () => importeer({
                        force: false,
                        alleenDb: true,
                        youtubeAlleen: true,
                        alleenZonderLokaal: true,
                        limiet: 250,
                    }),
                },
                {
                    aan: beheer.downloadsAutomatisch === true,
                    interval: 'downloadsIntervalUren',
                    volgende: 'downloadsVolgendeRun',
                    laatste: 'downloadsLaatsteRun',
                    taak: 'downloads-auto',
                    status: downloadStatus,
                    zetStatus: (v) => { downloadStatus = v; },
                    werk: () => downloadTracksVooruit({
                        alleenGecontroleerd: true,
                        alleenYoutube: true,
                        alleenZonderLokaal: true,
                        controleer: true,
                        limiet: 250,
                    }),
                },
            ];
            const plan = plannen.find((item) => item.aan
                && (!beheer[item.volgende] || new Date(beheer[item.volgende]).getTime() <= nu));
            if (!plan) return;
            const interval = Math.min(168, Math.max(1, Number(beheer[plan.interval]) || 24));
            const volgende = new Date(nu + interval * 60 * 60 * 1000).toISOString();
            const nieuw = { ...beheer, [plan.laatste]: new Date(nu).toISOString(), [plan.volgende]: volgende };
            await pool.query(`UPDATE app_instellingen SET waarde = $1::jsonb, bijgewerkt_op = now() WHERE sleutel = 'beheer'`, [JSON.stringify(nieuw)]);
            startAdminScript(plan.taak, plan.status, plan.zetStatus, plan.werk);
        } catch (err) {
            logger.waarschuwing('Periodieke playlist-refresh mislukt.', { melding: err.message });
        }
    }, 60 * 1000);
    playlistPlannerTimer.unref?.();
}
startPlaylistPlanner();

module.exports = router;
