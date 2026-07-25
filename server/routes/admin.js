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
// =====================================================================

const crypto = require('crypto');
const express = require('express');
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
const { downloadTrack } = require('../../seed/download-track');
const { hashWachtwoord, valideerWachtwoord } = require('../lib/auth');

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

// Hostaccounts beheren zonder het admin-wachtwoord in de database te zetten.
// Wachtwoorden worden nooit teruggestuurd; een reset maakt bestaande
// hostsessies direct ongeldig.
router.get('/api/admin/gebruikers', vereisAdmin, async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT id, gebruikersnaam, display_naam, actief, aangemaakt_op, laatst_ingelogd
           FROM gebruikers
          ORDER BY gebruikersnaam_norm ASC`,
    );
    res.json(rows);
});

router.patch('/api/admin/gebruikers/:id', vereisAdmin, async (req, res) => {
    const actief = req.body?.actief;
    if (typeof actief !== 'boolean') {
        return res.status(400).json({ fout: 'Geef actief als true of false.' });
    }
    const { rows } = await pool.query(
        `UPDATE gebruikers SET actief = $2 WHERE id = $1
         RETURNING id, gebruikersnaam, display_naam, actief`,
        [req.params.id, actief],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });
    if (!actief) {
        await pool.query(`DELETE FROM auth_sessies WHERE gebruiker_id = $1`, [req.params.id]);
    }
    res.json(rows[0]);
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
    res.json(rows[0]);
});

router.delete('/api/admin/tracks/:id', vereisAdmin, async (req, res) => {
    await pool.query(`DELETE FROM tracks WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

router.post('/api/admin/tracks/:id/download', vereisAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, t.naam
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          WHERE tr.id = $1`,
        [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ fout: 'Track niet gevonden.' });
    if (rows[0].bron !== 'itunes') {
        return res.status(400).json({ fout: 'Alleen iTunes-fallbacktracks kunnen hier lokaal worden gecachet.' });
    }
    try {
        await downloadTrack(rows[0]);
        res.json({ ok: true });
    } catch (err) {
        res.status(502).json({ fout: err.message });
    }
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

router.post('/api/admin/tmdb/import', vereisAdmin, (_req, res) => {
    const antwoord = startAdminScript(
        'tmdb',
        tmdbImportStatus,
        (v) => { tmdbImportStatus = v; },
        () => importeerTmdb(),
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
