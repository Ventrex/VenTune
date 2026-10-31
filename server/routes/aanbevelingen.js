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
            `SELECT soort, categorie, status, count(*)::int AS n
             FROM aanbevelingen GROUP BY soort, categorie, status`);
        const aantallen = {};
        for (const r of tel.rows) {
            aantallen[r.soort] = aantallen[r.soort] || {};
            aantallen[r.soort][r.status] = (aantallen[r.soort][r.status] || 0) + r.n;
        }
        const perCategorie = {};
        for (const r of tel.rows) {
            const naam = r.categorie || r.soort;
            perCategorie[naam] = perCategorie[naam] || { totaal: 0 };
            perCategorie[naam][r.status] = r.n;
            perCategorie[naam].totaal += r.n;
        }
        res.json({
            perCategorie,
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
    const aantal = Math.min(100, Math.max(1, Math.floor(Number(req.body && req.body.aantal) || 100)));
    const categorie = aanbevelingen.CATEGORIEEN.includes(req.body?.categorie) ? req.body.categorie : (soort === 'kerst' ? 'kerst' : 'film');
    const taal = (req.body && req.body.taal) || 'beide';

    run = { bezig: true, soort, categorie, gestart: new Date().toISOString(), klaar: null, resultaat: null, fout: null };
    res.json({ gestart: true, soort, categorie, aantal });

    // Achtergrond.
    aanbevelingen.genereer({ soort, categorie, aantal, taal })
        .then((r) => {
            run = { ...run, bezig: false, klaar: new Date().toISOString(), resultaat: r.ok ? r : null, fout: r.ok ? null : r.error };
        })
        .catch((err) => {
            logger.fout('Aanbevelingen genereren mislukt', { melding: err.message });
            run = { ...run, bezig: false, klaar: new Date().toISOString(), fout: err.message };
        });
});

// Handmatig een ontbrekende film of serie aanmelden voor muziekonderzoek.
router.post('/api/admin/aanbevelingen/handmatig', vereisAdmin, async (req, res) => {
    const titel = String(req.body?.titel || '').trim().slice(0, 160);
    const type = req.body?.type;
    const jaar = req.body?.jaar ? Number(req.body.jaar) : null;
    if (!titel || !['film', 'serie'].includes(type) || (jaar && (!Number.isInteger(jaar) || jaar < 1900 || jaar > 2100))) {
        return res.status(400).json({ fout: 'Geef een geldige titel, type en eventueel jaar op.' });
    }
    try {
        const bestaat = await pool.query(
            `SELECT naam FROM titels WHERE lower(trim(naam)) = lower($1)
             UNION ALL SELECT titel FROM aanbevelingen WHERE lower(trim(titel)) = lower($1) LIMIT 1`, [titel]);
        if (bestaat.rows.length) return res.status(409).json({ fout: 'Deze titel bestaat al in de database of aanbevelingen.' });
        const { rows } = await pool.query(
            `INSERT INTO aanbevelingen (soort, categorie, titel, type, jaar, tracknaam, artiest, youtube_zoekterm, bekendheid, reden, status)
             VALUES ('film_serie', $1, $2, $3, $4, '', '', $5, 3, 'Handmatig toegevoegd; juiste intro/soundtrack nog controleren', 'fout')
             RETURNING id`,
            [type, titel, type, jaar, `${titel} original theme soundtrack intro`]);
        res.json({ ok: true, id: rows[0].id, toelichting: 'Aan herzoekwachtrij toegevoegd. Nog niet speelbaar.' });
    } catch (err) { res.status(500).json({ fout: err.message }); }
});
router.post('/api/admin/titels/:id/ai-quiz', vereisAdmin, async (req, res) => {
    try {
        const resultaat = await aanbevelingen.vulQuizMetadata(Number(req.params.id));
        return res.status(resultaat.ok ? 200 : 422).json(resultaat.ok ? resultaat : { fout: resultaat.error });
    } catch (err) { return res.status(500).json({ fout: err.message }); }
});

// Lijst om te swipen. fase=blind → status 'nieuw' (ronde 1, zonder naam).
// fase=naam → status 'blind_nee' (ronde 2, met naam).
router.get('/api/admin/aanbevelingen', vereisAdmin, async (req, res) => {
    try {
        const categorie = aanbevelingen.CATEGORIEEN.includes(req.query.categorie) ? req.query.categorie : null;
        const soort = req.query.soort === 'kerst' ? 'kerst' : req.query.soort === 'muziek' ? 'muziek' : 'film_serie';
        const fase = req.query.fase === 'naam' ? 'blind_nee' : 'nieuw';
        const { rows } = await pool.query(
            `SELECT id, soort, titel, type, jaar, genres, tracknaam, artiest,
                    youtube_zoekterm, bekendheid, reden, voorbeeld_bron, status
             FROM aanbevelingen
             WHERE ($1::text IS NULL OR categorie = $1) AND status = $2
             ORDER BY bekendheid DESC, aangemaakt_op
             LIMIT 100`, [categorie, fase]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ fout: err.message });
    }
});

// Zet alle audio voor de geselecteerde swipe-ronde eerst klaar, maximaal
// twee downloads tegelijk om YouTube en de server niet te overbelasten.
const voorbereidingen = new Map();
router.post('/api/admin/aanbevelingen/voorbereiden', vereisAdmin, async (req, res) => {
    const soort = req.body?.soort === 'kerst' ? 'kerst' : 'film_serie';
    const status = req.body?.fase === 'naam' ? 'blind_nee' : 'nieuw';
    const sleutel = `${soort}:${status}`;
    const actief = voorbereidingen.get(sleutel);
    if (actief?.bezig) return res.json(actief);
    try {
        const { rows } = await pool.query(
            'SELECT * FROM aanbevelingen WHERE soort = $1 AND status = $2 ORDER BY bekendheid DESC, aangemaakt_op LIMIT 100',
            [soort, status]);
        const taak = { bezig: true, totaal: rows.length, klaar: 0, fouten: 0, eersteFout: null };
        voorbereidingen.set(sleutel, taak);
        res.json(taak);
        (async () => {
            let volgend = 0;
            await Promise.all(Array.from({ length: Math.min(2, rows.length) }, async () => {
                while (volgend < rows.length) {
                    const a = rows[volgend++];
                    try { await media.lokaalVoorbeeld(a); }
                    catch (err) {
                        taak.fouten++;
                        if (!taak.eersteFout) taak.eersteFout = err.message;
                        logger.waarschuwing('Voorbereiden luistervoorbeeld mislukt', { id: a.id, melding: err.message });
                    }
                    taak.klaar++;
                }
            }));
            taak.bezig = false;
        })().catch((err) => { taak.bezig = false; taak.eersteFout = err.message; });
    } catch (err) { res.status(500).json({ fout: err.message }); }
});
router.get('/api/admin/aanbevelingen/voorbereiden/status', vereisAdmin, (req, res) => {
    const sleutel = `${req.query.soort === 'kerst' ? 'kerst' : 'film_serie'}:${req.query.fase === 'naam' ? 'blind_nee' : 'nieuw'}`;
    res.json(voorbereidingen.get(sleutel) || { bezig: false, totaal: 0, klaar: 0, fouten: 0 });
});

/** MP3-downloads starten asynchroon: een lange yt-dlp download mag niet
 * door de reverse proxy als 504 worden afgebroken. */
const audioTaken = new Map();
router.get('/api/admin/aanbevelingen/:id/audio', vereisAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ fout: 'Ongeldig ID.' });
    try {
        const { rows } = await pool.query('SELECT * FROM aanbevelingen WHERE id = $1', [id]);
        if (!rows[0]) return res.status(404).json({ fout: 'Aanbeveling niet gevonden.' });
        let taak = audioTaken.get(id);
        // Fouten blijven kort zichtbaar en kunnen daarna opnieuw worden geprobeerd.
        if (taak?.status === 'fout' && Date.now() - taak.sinds > 30000) {
            audioTaken.delete(id);
            taak = null;
        }
        if (!taak) {
            taak = { status: 'bezig', sinds: Date.now() };
            audioTaken.set(id, taak);
            media.lokaalVoorbeeld(rows[0])
                .then((result) => Object.assign(taak, { status: 'klaar', audioUrl: result.audioUrl }))
                .catch((err) => {
                    logger.waarschuwing('Luistervoorbeeld downloaden mislukt', { id, melding: err.message });
                    Object.assign(taak, { status: 'fout', fout: String(err.message).slice(0, 500), sinds: Date.now() });
                });
        }
        if (taak.status === 'fout') return res.status(502).json({ fout: taak.fout });
        if (taak.status === 'klaar') return res.json({ audioUrl: taak.audioUrl });
        return res.status(202).json({ bezig: true, id });
    } catch (err) {
        logger.waarschuwing('Luistervoorbeeld API mislukt', { id, melding: err.message });
        return res.status(500).json({ fout: String(err.message).slice(0, 300) });
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

// Herstel bestaande korte MP3's op verzoek van de beheerder.
let herstelRun = { bezig: false, totaal: 0, verwerkt: 0, hersteld: 0, mislukt: 0, fouten: [] };
router.get('/api/admin/audio-herstel/status', vereisAdmin, (_req, res) => res.json(herstelRun));
router.post('/api/admin/audio-herstel/start', vereisAdmin, (_req, res) => {
    if (herstelRun.bezig) return res.status(409).json({ fout: 'Audioherstel loopt al.' });
    herstelRun = { bezig: true, totaal: 0, verwerkt: 0, hersteld: 0, mislukt: 0, fouten: [] };
    res.json({ gestart: true });
    media.herstelGoedgekeurdeAudio({ voortgang: (status) => { herstelRun = { ...status, bezig: true }; } })
        .then((status) => { herstelRun = { ...status, bezig: false }; })
        .catch((err) => {
            logger.fout('Audioherstel mislukt', { melding: err.message });
            herstelRun = { ...herstelRun, bezig: false, fout: err.message };
        });
});

// Downloads die op de achtergrond lopen na een 'goed'-swipe.
const downloads = new Map(); // id -> { status, error }

function startDownload(id) {
    downloads.set(id, { status: 'bezig', error: null });
    media.verwerkGoed(id)
        .then((r) => {
            downloads.set(id, { status: r.ok ? 'klaar' : 'fout', error: r.ok ? null : r.error });
            if (r.ok) aanbevelingen.vulQuizMetadata(r.titelId).catch((err) =>
                logger.waarschuwing('AI-bonusvragen niet beschikbaar', { melding: err.message }));
        })
        .catch((e) => downloads.set(id, { status: 'fout', error: String(e.message) }));
}

// Swipe. In ronde 1 (blind) is keuze 'herkend' of 'niet'. In ronde 2 (naam)
// is keuze 'goed', 'fout' of 'onbekend'.
router.post('/api/admin/aanbevelingen/:id/swipe', vereisAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const keuze = req.body && req.body.keuze;
    const fase = req.body && req.body.fase === 'naam' ? 'naam' : 'blind';
    try {
        if (keuze === 'verkeerde_mp3') {
            const verwacht = fase === 'blind' ? 'nieuw' : 'blind_nee';
            const { rows } = await pool.query(
                `UPDATE aanbevelingen SET
                    afgekeurde_bronnen = CASE
                        WHEN voorbeeld_bron IS NOT NULL AND NOT (voorbeeld_bron = ANY(afgekeurde_bronnen))
                        THEN array_append(afgekeurde_bronnen, voorbeeld_bron)
                        ELSE afgekeurde_bronnen END,
                    voorbeeld_bron = NULL, fout_aantal = fout_aantal + 1,
                    status = CASE WHEN fout_aantal + 1 >= 3 THEN 'fout' ELSE 'nieuw' END,
                    beoordeeld_op = now()
                 WHERE id = $1 AND status = $2
                 RETURNING id, fout_aantal`, [id, verwacht]);
            if (!rows[0]) return res.status(404).json({ fout: 'Niet gevonden of al beoordeeld.' });
            await media.keurMp3Af(id);
            audioTaken.delete(id);
            return res.json({
                ok: true,
                status: rows[0].fout_aantal < 3 ? 'nieuw' : 'fout',
                opnieuw: rows[0].fout_aantal < 3,
            });
        }
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
