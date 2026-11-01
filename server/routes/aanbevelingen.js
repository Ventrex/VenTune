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

// Bestaande film/serie-metadata voorzichtig verrijken met gecontroleerde TMDB-gegevens.
// Geen automatische overschrijving van correcte bestaande waarden.
const verrijking = { bezig: false, totaal: 0, klaar: 0, aangepast: 0, gemist: 0, fout: null };
router.get('/api/admin/metadata-verrijken/status', vereisAdmin, (_req, res) => res.json(verrijking));
router.post('/api/admin/metadata-verrijken/start', vereisAdmin, async (_req, res) => {
    if (verrijking.bezig) return res.status(409).json({ fout: 'Verrijking draait al.' });
    const tmdb = require('../lib/tmdb');
    if (!tmdb.beschikbaar()) return res.status(422).json({ fout: 'TMDB_API_KEY is nog niet ingesteld.' });
    const { rows } = await pool.query(`
       SELECT id, naam, type, jaar FROM titels
       WHERE type IN ('film','serie') AND (
           poster_pad IS NULL OR omschrijving IS NULL OR btrim(omschrijving) = ''
           OR genres IS NULL OR cardinality(genres) = 0 OR jaar IS NULL
           OR studio IS NULL OR lower(studio) = 'onbekend')
       ORDER BY id LIMIT 100`);
    Object.assign(verrijking, { bezig: true, totaal: rows.length, klaar: 0, aangepast: 0, gemist: 0, fout: null });
    res.json({ gestart: true, totaal: rows.length });
    (async () => {
        for (const t of rows) {
            try {
                const info = await tmdb.zoekPresentatie(t.naam, t.type, t.jaar);
                if (!info) { verrijking.gemist++; continue; }
                const details = await tmdb.haalDetails(info.tmdbId, t.type);
                await pool.query(`UPDATE titels SET
                    tmdb_id = COALESCE(tmdb_id, $2),
                    poster_pad = COALESCE(poster_pad, $3),
                    omschrijving = COALESCE(NULLIF(omschrijving, ''), $4),
                    genres = ARRAY(SELECT DISTINCT g FROM unnest(
                        CASE WHEN genres IS NULL THEN '{}'::text[] ELSE genres END || $5::text[]
                     ) AS g WHERE btrim(g) <> '' AND lower(g) <> 'onbekend'),
                    studio = CASE WHEN studio IS NULL OR lower(studio) = 'onbekend' THEN $6 ELSE studio END,
                    jaar = COALESCE(jaar, $7)
                    WHERE id = $1`,
                    [t.id, info.tmdbId, info.posterPad, info.omschrijving,
                     details.genres || [], details.studio, info.jaar]);
                verrijking.aangepast++;
            } catch (err) {
                logger.waarschuwing('Titelmetadata niet verrijkt', { titelId: t.id, melding: err.message });
                verrijking.gemist++;
            } finally { verrijking.klaar++; }
        }
    })().catch((err) => { verrijking.fout = err.message; }).finally(() => { verrijking.bezig = false; });
});

// Inzicht in automatisch gegenereerde hints en bonusvragen per titel.
router.get('/api/admin/quiz-inhoud', vereisAdmin, async (req, res) => {
    try {
        const zoek = String(req.query.zoek || '').trim().slice(0, 80);
        const { rows } = await pool.query(
            `SELECT t.id, t.naam, t.type::text AS type, t.jaar, t.ai_hints, t.ai_hints_status,
                    (SELECT COALESCE(json_agg(json_build_object(
                        'vraag', v.vraag, 'opties', v.opties, 'correct_index', v.correct_index, 'id', v.id, 'status', v.ai_review_status)
                        ORDER BY v.id), '[]'::json)
                       FROM vragen v WHERE v.titel_id = t.id) AS vragen
               FROM titels t
              WHERE t.type IN ('film', 'serie')
                AND ($1::text = '' OR t.naam ILIKE '%' || $1::text || '%')
              ORDER BY t.naam LIMIT 100`, [zoek]);
        res.json({ titels: rows });
    } catch (err) {
        logger.waarschuwing('Quizinhoud ophalen mislukt', { melding: err.message });
        res.status(500).json({ fout: 'Kon quizvragen niet ophalen: ' + err.message });
    }
});

router.get('/api/admin/herkenbaarheid', vereisAdmin, async (req, res) => {
    try {
        const zoek = String(req.query.zoek || '').trim().slice(0, 80);
        const { rows } = await pool.query(`SELECT t.id, t.naam, t.type::text AS type,
            h.leeftijdsgroep, count(*)::int AS stemmen,
            count(*) FILTER (WHERE h.herkenbaar = false)::int AS onbekend
            FROM titel_herkenbaarheid h JOIN titels t ON t.id=h.titel_id
            WHERE ($1::text='' OR t.naam ILIKE '%' || $1 || '%')
            GROUP BY t.id, t.naam, t.type, h.leeftijdsgroep
            ORDER BY onbekend DESC, stemmen DESC, t.naam LIMIT 300`, [zoek]);
        res.json({ resultaten: rows, toelichting: 'Pas na minimaal 8 stemmen per leeftijdsgroep wordt herkenbaarheid voor die groep meegewogen; niets wordt verwijderd.' });
    } catch (err) { res.status(500).json({ fout: err.message }); }
});

// Catalogus is iets anders dan ChatGPT-aanbevelingen: toon aantallen uit titels.
router.get('/api/admin/catalogus-tellingen', vereisAdmin, async (_req,res)=>{
    try {
        const {rows}=await pool.query(`
            SELECT t.type::text AS type, COUNT(*)::int AS titels,
                COUNT(*) FILTER (WHERE t.curatie_status='te_beoordelen')::int AS te_beoordelen,
                COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM tracks tr WHERE tr.titel_id=t.id
                    AND tr.bron='lokaal' AND tr.werkt=true AND tr.download_status='available'
                    AND NULLIF(tr.preview_url,'') IS NOT NULL
                ))::int AS met_mp3
            FROM titels t WHERE t.type IN ('film','serie')
            GROUP BY t.type ORDER BY t.type`);
        res.json({categorieen:rows});
    } catch(err) {res.status(500).json({fout:err.message});}
});
// Controle van quizmateriaal: alleen lokale speelbare MP3's tellen mee.
// Suggesties in controle zijn apart van definitief goedgekeurde inhoud.
router.get('/api/admin/quiz-gezondheid', vereisAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT t.id, t.naam, t.type::text AS type, t.jaar,
                COALESCE(array_length(t.ai_hints, 1),0)::int AS hints,
                t.ai_hints_status,
                (SELECT count(*)::int FROM vragen v WHERE v.titel_id=t.id AND v.soort='ai') AS vragen,
                (SELECT count(*)::int FROM vragen v WHERE v.titel_id=t.id AND v.soort='ai' AND v.ai_review_status='goedgekeurd') AS vragen_goedgekeurd,
                EXISTS (SELECT 1 FROM tracks tr WHERE tr.titel_id=t.id
                    AND tr.werkt=true AND tr.bron='lokaal'
                    AND tr.download_status='available'
                    AND tr.preview_url IS NOT NULL AND tr.preview_url <> '') AS heeft_mp3
            FROM titels t WHERE t.type IN ('film','serie')
            ORDER BY t.id`);
        const problemen = rows.filter(t => !t.heeft_mp3 || t.hints < 3 || t.vragen < 3 ||
            t.ai_hints_status !== 'goedgekeurd' || t.vragen_goedgekeurd < 3);
        res.json({
            totaal: rows.length,
            zonder_mp3: rows.filter(t => !t.heeft_mp3).length,
            zonder_3_hints: rows.filter(t => t.hints < 3).length,
            hints_ter_controle: rows.filter(t => t.hints >= 3 && t.ai_hints_status !== 'goedgekeurd').length,
            zonder_3_vragen: rows.filter(t => t.vragen < 3).length,
            vragen_ter_controle: rows.filter(t => t.vragen >= 3 && t.vragen_goedgekeurd < 3).length,
            problemen: problemen.slice(0, 250)
        });
    } catch (err) { res.status(500).json({ fout: err.message }); }
});

// AI-vragenbank: voortgang, bulk-generatie en expliciete controle door beheerder.
const quizBatch = { bezig: false, totaal: 0, verwerkt: 0, gelukt: 0, controle_nodig: 0, mislukt: 0, fouten: [] };
router.get('/api/admin/ai-vragen/status', vereisAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT
            count(*)::int AS titels,
            count(*) FILTER (WHERE coalesce(array_length(t.ai_hints,1),0) >= 3)::int AS hints_gegenereerd,
            count(*) FILTER (WHERE coalesce(array_length(t.ai_hints,1),0) >= 3 AND t.ai_hints_status = 'goedgekeurd')::int AS hints_goedgekeurd,
            count(*) FILTER (WHERE (SELECT count(*) FROM vragen v WHERE v.titel_id=t.id AND v.soort='ai') >= 3)::int AS vragen_gegenereerd,
            count(*) FILTER (WHERE (SELECT count(*) FROM vragen v WHERE v.titel_id=t.id AND v.soort='ai' AND v.ai_review_status='goedgekeurd') >= 3)::int AS vragen_goedgekeurd
            FROM titels t WHERE t.type IN ('film','serie')`);
        return res.json({ ...quizBatch, database: rows[0] });
    } catch (err) { return res.status(500).json({ fout: err.message }); }
});
router.post('/api/admin/ai-vragen/start', vereisAdmin, async (req, res) => {
    if (quizBatch.bezig) return res.status(409).json({ fout: 'Generatie loopt al.' });
    const maximaal = Math.min(500, Math.max(1, Number(req.body?.limiet) || 100));
    const { rows } = await pool.query(`
       SELECT t.id FROM titels t WHERE t.type IN ('film','serie')
         AND (coalesce(array_length(t.ai_hints,1),0) < 3
           OR t.ai_hints_status = 'afgekeurd'
           OR (SELECT count(*) FROM vragen v WHERE v.titel_id=t.id AND v.soort='ai' AND v.ai_review_status IN ('goedgekeurd','controle_nodig')) < 3)
       ORDER BY t.id LIMIT $1`, [maximaal]);
    Object.assign(quizBatch, { bezig: true, totaal: rows.length, verwerkt: 0, gelukt: 0, controle_nodig: 0, mislukt: 0, fouten: [] });
    res.json({ gestart: true, totaal: rows.length });
    (async () => {
        for (const t of rows) {
            try {
                const r = await aanbevelingen.vulQuizMetadata(t.id);
                if (r.ok) { quizBatch.gelukt++; quizBatch.controle_nodig++; }
                else { quizBatch.mislukt++; if (quizBatch.fouten.length < 15) quizBatch.fouten.push({ id: t.id, fout: r.error }); }
            } catch (err) {
                quizBatch.mislukt++;
                if (quizBatch.fouten.length < 15) quizBatch.fouten.push({ id: t.id, fout: err.message });
            } finally { quizBatch.verwerkt++; }
        }
    })().catch(err => { logger.fout('AI-vragenbatch mislukt', { melding: err.message }); })
      .finally(() => { quizBatch.bezig = false; });
});
router.patch('/api/admin/ai-hints/:id', vereisAdmin, async (req, res) => {
    const hints = req.body?.hints;
    if (!Array.isArray(hints) || hints.length !== 3 || hints.some(h => typeof h !== 'string' || !h.trim() || h.length > 250)) {
        return res.status(400).json({ fout: 'Vul exact drie verschillende hints in (max 250 tekens).' });
    }
    const { rows } = await pool.query(
        "UPDATE titels SET ai_hints=$2, ai_hints_status='controle_nodig' WHERE id=$1 AND type IN ('film','serie') RETURNING id",
        [req.params.id, hints.map(h=>h.trim())]);
    return rows.length ? res.json({ ok: true, status: 'controle_nodig' }) : res.status(404).json({ fout: 'Titel niet gevonden' });
});
router.post('/api/admin/ai-hints/:id/beoordeel', vereisAdmin, async (req, res) => {
    const status = req.body?.status;
    if (!['goedgekeurd','afgekeurd'].includes(status)) return res.status(400).json({ fout: 'Ongeldige beoordeling' });
    const { rows } = await pool.query("SELECT id, ai_hints FROM titels WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ fout: 'Titel niet gevonden' });
    const { rows: qs } = await pool.query("SELECT vraag, opties, correct_index FROM vragen WHERE titel_id=$1 AND soort='ai' AND ai_review_status <> 'afgekeurd'", [req.params.id]);
    const fouten = qs.some(q => (rows[0].ai_hints || []).some(h => {
        const juist = aanbevelingen.quizTekst(q.opties[q.correct_index]);
        const hint = aanbevelingen.quizTekst(h);
        return (juist.length >= 3 && hint.includes(juist)) ||
            aanbevelingen.vraagHintOverlap(h, q.vraag);
    }));
    if (status === 'goedgekeurd' && (rows[0].ai_hints || []).length !== 3) return res.status(422).json({ fout: 'Eerst drie hints invoeren.' });
    if (status === 'goedgekeurd' && fouten) return res.status(422).json({ fout: 'Controleer antwoordlekken tussen hints en vragen.' });
    await pool.query('UPDATE titels SET ai_hints_status=$2 WHERE id=$1', [req.params.id,status]);
    res.json({ ok: true, status });
});
router.patch('/api/admin/ai-vraag/:id', vereisAdmin, async (req, res) => {
    const q = req.body;
    if (typeof q?.vraag !== 'string' || !q.vraag.trim() || !Array.isArray(q.opties) || q.opties.length !== 6 ||
        !q.opties.every(o=>typeof o==='string'&&o.trim()) || !Number.isInteger(q.correct_index) || q.correct_index<0 || q.correct_index>5)
        return res.status(400).json({ fout:'Vul een vraag en zes opties met het juiste antwoord in.' });
    const { rows }=await pool.query(
        "UPDATE vragen SET vraag=$2,opties=$3::jsonb,correct_index=$4,ai_review_status='controle_nodig' WHERE id=$1 AND soort='ai' RETURNING id",
        [req.params.id,q.vraag.trim(),JSON.stringify(q.opties),q.correct_index]);
    return rows.length?res.json({ok:true}):res.status(404).json({fout:'Vraag niet gevonden'});
});
router.post('/api/admin/ai-vraag/:id/beoordeel', vereisAdmin, async (req, res) => {
    const status=req.body?.status;
    if (!['goedgekeurd','afgekeurd'].includes(status)) return res.status(400).json({fout:'Ongeldige beoordeling'});
    const {rows}=await pool.query("SELECT v.*,t.ai_hints FROM vragen v JOIN titels t ON t.id=v.titel_id WHERE v.id=$1 AND v.soort='ai'",[req.params.id]);
    if (!rows.length) return res.status(404).json({fout:'Vraag niet gevonden'});
    const q=rows[0];
    if(status==='goedgekeurd'){
        if (!Array.isArray(q.opties) || q.opties.length !== 6 ||
            !Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= 6)
            return res.status(422).json({fout:'De vraag heeft geen zes geldige antwoorden.'});
        const answer = aanbevelingen.quizTekst(q.opties[q.correct_index]);
        if ((q.ai_hints || []).some(h => {
            const hint = aanbevelingen.quizTekst(h);
            return (answer.length >= 3 && hint.includes(answer)) ||
                aanbevelingen.vraagHintOverlap(h, q.vraag);
        })) return res.status(422).json({fout:'Een hint verklapt deze vraag of het antwoord. Pas eerst hints of vraag aan.'});
    }
    await pool.query('UPDATE vragen SET ai_review_status=$2 WHERE id=$1',[req.params.id,status]);
    res.json({ok:true,status});
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

// Persistente AI-wachtrij. Nieuwe requests worden opgeslagen in PostgreSQL;
// een paginawissel onderbreekt het werk niet en na serverstart worden taken hervat.
let queueWorkerRunning = false;
let queueReady = null;
function initAiQueue() {
    if (!queueReady) queueReady = pool.query(`
        CREATE TABLE IF NOT EXISTS ai_aanbeveling_taken (
          id BIGSERIAL PRIMARY KEY,
          categorie TEXT NOT NULL, soort TEXT NOT NULL, taal TEXT NOT NULL DEFAULT 'beide',
          gevraagd INTEGER NOT NULL, verwerkt INTEGER NOT NULL DEFAULT 0,
          toegevoegd INTEGER NOT NULL DEFAULT 0, overgeslagen INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'wachtend',
          fout TEXT, aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
          gestart_op TIMESTAMPTZ, bijgewerkt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
          afgerond_op TIMESTAMPTZ
        )`).then(() => pool.query("UPDATE ai_aanbeveling_taken SET status='wachtend' WHERE status='bezig'"));
    return queueReady;
}
async function loopAiQueue() {
    if (queueWorkerRunning) return;
    queueWorkerRunning = true;
    try {
        await initAiQueue();
        while (true) {
            const {rows} = await pool.query("SELECT * FROM ai_aanbeveling_taken WHERE status='wachtend' ORDER BY id LIMIT 1");
            const taak=rows[0];
            if (!taak) break;
            await pool.query("UPDATE ai_aanbeveling_taken SET status='bezig', gestart_op=COALESCE(gestart_op,now()), bijgewerkt_op=now() WHERE id=$1",[taak.id]);
            let verwerkt=Number(taak.verwerkt), toegevoegd=Number(taak.toegevoegd), overgeslagen=Number(taak.overgeslagen);
            let fout=null;
            // Elke stap is maximaal 100 stuks en wordt afzonderlijk opgeslagen.
            // Herstarten kan vanaf de laatst afgeronde stap.
            while (verwerkt < Number(taak.gevraagd)) {
                try {
                    const stap=Math.min(100,Number(taak.gevraagd)-verwerkt);
                    const resultaat=await aanbevelingen.genereer({soort:taak.soort,categorie:taak.categorie,taal:taak.taal,aantal:stap});
                    if (!resultaat.ok) { fout=resultaat.error || 'AI leverde geen nieuwe kandidaten.'; break; }
                    toegevoegd+=Number(resultaat.toegevoegd||0);
                    overgeslagen+=Number(resultaat.overgeslagen||0);
                    verwerkt+=stap;
                    await pool.query("UPDATE ai_aanbeveling_taken SET verwerkt=$2,toegevoegd=$3,overgeslagen=$4,bijgewerkt_op=now() WHERE id=$1",
                        [taak.id,verwerkt,toegevoegd,overgeslagen]);
                } catch(err) { fout=err.message; break; }
            }
            await pool.query("UPDATE ai_aanbeveling_taken SET status=$2,fout=$3,verwerkt=$4,toegevoegd=$5,overgeslagen=$6,afgerond_op=now(),bijgewerkt_op=now() WHERE id=$1",
                [taak.id,fout?'fout':'klaar',fout,verwerkt,toegevoegd,overgeslagen]);
        }
    } catch(err) { logger.fout('AI-wachtrij mislukt', {melding:err.message}); }
    finally { queueWorkerRunning=false; }
}
router.get('/api/admin/aanbevelingen/wachtrij', vereisAdmin, async (_req,res)=>{
    try {
        await initAiQueue();
        const {rows}=await pool.query("SELECT * FROM ai_aanbeveling_taken ORDER BY id DESC LIMIT 30");
        res.json({taken:rows});
    } catch(err) {res.status(500).json({fout:err.message});}
});
router.post('/api/admin/aanbevelingen/genereer', vereisAdmin, async (req, res) => {
    const soort = req.body?.soort === 'kerst' ? 'kerst' : 'film_serie';
    const categorie = aanbevelingen.CATEGORIEEN.includes(req.body?.categorie) ? req.body.categorie : (soort === 'kerst' ? 'kerst' : 'film');
    const aantal = Math.min(10000, Math.max(1, Math.floor(Number(req.body?.aantal) || 100)));
    const taal = ['nl','en','beide'].includes(req.body?.taal) ? req.body.taal : 'beide';
    try {
        await initAiQueue();
        const {rows}=await pool.query(
            "INSERT INTO ai_aanbeveling_taken(categorie,soort,taal,gevraagd) VALUES($1,$2,$3,$4) RETURNING id,status,gevraagd",
            [categorie,soort,taal,aantal]);
        res.json({gestart:true,queue:true,taak_id:rows[0].id,aantal,status:'wachtend'});
        setImmediate(()=>loopAiQueue().catch(err=>logger.fout('AI-worker fout',{melding:err.message})));
    } catch(err) {res.status(500).json({fout:err.message});}
});
// Bij het starten van de server de onafgemaakte taken oppakken.
setTimeout(()=>loopAiQueue().catch(err=>logger.fout('AI-wachtrij herstellen mislukt',{melding:err.message})),5000).unref();

// Videogames: een eigen catalogus met platformen; films/series blijven gescheiden.
const GAME_PLATFORMS=['PC','PlayStation 1','PlayStation 2','PlayStation 3','PlayStation 4','PlayStation 5','PSP','PS Vita','Xbox','Xbox 360','Xbox One','Xbox Series X/S','NES','SNES','Nintendo 64','GameCube','Wii','Wii U','Nintendo Switch','Nintendo Switch 2','Game Boy','Game Boy Color','Game Boy Advance','Nintendo DS','Nintendo 3DS','Sega Mega Drive','Sega Dreamcast','Atari','Arcade','Overig'];
let gameReady=null;
function initGames(){
    if(!gameReady) gameReady=pool.query(`CREATE TABLE IF NOT EXISTS game_catalogus (
        id BIGSERIAL PRIMARY KEY, naam TEXT NOT NULL, jaar INTEGER,
        platformen TEXT[] NOT NULL DEFAULT '{}', opmerking TEXT,
        status TEXT NOT NULL DEFAULT 'nieuw',
        aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(naam,jaar)
    )`);
    return gameReady;
}
router.get('/api/admin/games/platformen',vereisAdmin,(_req,res)=>res.json(GAME_PLATFORMS));
router.get('/api/admin/games',vereisAdmin,async(_req,res)=>{
    try {await initGames();const {rows}=await pool.query('SELECT * FROM game_catalogus ORDER BY CASE WHEN status=\'nieuw\' THEN 0 ELSE 1 END, id DESC LIMIT 500');res.json(rows);}
    catch(err){res.status(500).json({fout:err.message});}
});
router.post('/api/admin/games',vereisAdmin,async(req,res)=>{
    try{
        await initGames();
        const naam=String(req.body?.naam||'').trim().slice(0,150);
        const jaar=req.body?.jaar ? Number(req.body.jaar) : null;
        const platformen=[...new Set(Array.isArray(req.body?.platformen)?req.body.platformen:[])].filter(x=>GAME_PLATFORMS.includes(x));
        if(!naam||!platformen.length||jaar!==null&&(!Number.isInteger(jaar)||jaar<1970||jaar>2100))
            return res.status(400).json({fout:'Naam, minstens één platform en een geldig jaartal zijn vereist.'});
        const {rows}=await pool.query(`INSERT INTO game_catalogus(naam,jaar,platformen,opmerking)
            VALUES($1,$2,$3,$4) ON CONFLICT(naam,jaar) DO UPDATE SET
            platformen=(SELECT ARRAY(SELECT DISTINCT unnest(game_catalogus.platformen || EXCLUDED.platformen)))
            RETURNING *`,[naam,jaar,platformen,String(req.body?.opmerking||'').slice(0,500)]);
        res.json(rows[0]);
    }catch(err){res.status(500).json({fout:err.message});}
});
router.patch('/api/admin/games/:id',vereisAdmin,async(req,res)=>{
    try{
        await initGames();
        if(!['goedgekeurd','uitgesloten'].includes(req.body?.status)) return res.status(400).json({fout:'Ongeldige status'});
        const {rows}=await pool.query('UPDATE game_catalogus SET status=$2 WHERE id=$1 RETURNING *',[req.params.id,req.body.status]);
        if(!rows.length)return res.status(404).json({fout:'Game niet gevonden'});
        res.json(rows[0]);
    }catch(err){res.status(500).json({fout:err.message});}
});

// Directe Swipe-wachtrij voor alle bestaande films/series zonder MP3.
// Handmatig aangedragen titels krijgen altijd voorrang.
async function initPrioriteit() {
    await pool.query("ALTER TABLE titels ADD COLUMN IF NOT EXISTS swipe_prioriteit TIMESTAMPTZ");
}
router.get('/api/admin/swipe/zonder-mp3', vereisAdmin, async (req,res)=>{
    try {
        await initPrioriteit();
        const type=['film','serie'].includes(req.query.type)?req.query.type:'film';
        const {rows}=await pool.query(`
            SELECT t.id,t.naam,t.type::text AS type,t.jaar,t.poster_pad,t.swipe_prioriteit,
                   t.zoek_status,t.zoek_melding
            FROM titels t WHERE t.type::text=$1
              AND t.curatie_status <> 'uitgesloten'
              AND NOT EXISTS (
                SELECT 1 FROM tracks tr WHERE tr.titel_id=t.id AND tr.werkt=true
                  AND tr.bron='lokaal' AND tr.download_status='available'
                  AND NULLIF(tr.preview_url,'') IS NOT NULL
              )
            ORDER BY t.swipe_prioriteit DESC NULLS LAST, t.populariteit DESC, t.id
            LIMIT 200`,[type]);
        const {rows:count}=await pool.query(`
            SELECT count(*)::int AS n FROM titels t WHERE t.type::text=$1
              AND t.curatie_status <> 'uitgesloten'
              AND NOT EXISTS(SELECT 1 FROM tracks tr WHERE tr.titel_id=t.id
                AND tr.werkt=true AND tr.bron='lokaal'
                AND tr.download_status='available' AND NULLIF(tr.preview_url,'') IS NOT NULL)`,[type]);
        res.json({kaarten:rows,totaal:count[0].n});
    }catch(err){res.status(500).json({fout:err.message});}
});
router.post('/api/admin/swipe/zonder-mp3/:id', vereisAdmin, async(req,res)=>{
    try {
        const actie=req.body?.actie;
        if(!['prioriteit','overslaan'].includes(actie)) return res.status(400).json({fout:'Ongeldige keuze'});
        await initPrioriteit();
        const {rows}=await pool.query(
            "UPDATE titels SET swipe_prioriteit=$2, zoek_status=CASE WHEN $3='prioriteit' THEN 'nieuw' ELSE zoek_status END, volgende_poging=CASE WHEN $3='prioriteit' THEN NULL ELSE volgende_poging END WHERE id=$1 AND type IN ('film','serie') RETURNING id,naam",
            [req.params.id,actie==='prioriteit'?new Date():null,actie]);
        if(!rows.length) return res.status(404).json({fout:'Titel niet gevonden'});
        res.json({ok:true,titel:rows[0]});
    }catch(err){res.status(500).json({fout:err.message});}
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
        await initPrioriteit();
        const bestaandTitel = await pool.query(
            `SELECT t.id, t.naam, t.type,
                    EXISTS (SELECT 1 FROM tracks tr WHERE tr.titel_id=t.id AND tr.werkt=true
                        AND tr.bron='lokaal' AND tr.download_status='available'
                        AND NULLIF(tr.preview_url,'') IS NOT NULL) AS heeft_mp3
               FROM titels t WHERE lower(trim(t.naam))=lower($1) AND t.type=$2
               ORDER BY t.id LIMIT 1`, [titel,type]);
        const bestaandAdvies = await pool.query(
            `SELECT id,status FROM aanbevelingen WHERE lower(trim(titel))=lower($1) AND type=$2
             ORDER BY id DESC LIMIT 1`, [titel,type]);
        if (bestaandTitel.rows[0]) await pool.query('UPDATE titels SET swipe_prioriteit=now(), zoek_status=CASE WHEN $2 THEN zoek_status ELSE \'wachtend\' END, volgende_poging=CASE WHEN $2 THEN volgende_poging ELSE NULL END WHERE id=$1',[bestaandTitel.rows[0].id,bestaandTitel.rows[0].heeft_mp3]);
        if (bestaandTitel.rows[0]?.heeft_mp3) {
            return res.json({ok:true, bestaand:true, heeft_mp3:true, titel_id:bestaandTitel.rows[0].id,
                toelichting:'Titel bestaat al en heeft een speelbare lokale MP3. Geen dubbele aanvraag aangemaakt.'});
        }
        if (bestaandAdvies.rows[0]) {
            const a=bestaandAdvies.rows[0];
            if (a.status !== 'nieuw' && a.status !== 'blind_nee') {
                await pool.query("UPDATE aanbevelingen SET status='fout', beoordeeld_op=NULL WHERE id=$1",[a.id]);
            }
            return res.json({ok:true,bestaand:true,heeft_mp3:false,id:a.id,
                titel_id:bestaandTitel.rows[0]?.id ?? null,
                toelichting:'Titel bestaat al, maar mist een speelbare MP3. Bestaande aanvraag is voor muziekonderzoek in de wachtrij gezet.'});
        }
        // Nieuwe handmatige titel onmiddellijk in de catalogus en hoogste Swipe-prioriteit.
        const nieuw=await pool.query(
            "INSERT INTO titels (naam,type,taal,jaar,curatie_status,nl_tv_bekend,toevoeg_reden,swipe_prioriteit) VALUES ($1,$2,$3,$4,'goedgekeurd',true,'Handmatig toegevoegd',now()) RETURNING id",
            [titel,type,'en',jaar]);
        const { rows } = await pool.query(
            `INSERT INTO aanbevelingen (soort, categorie, titel, type, jaar, tracknaam, artiest, youtube_zoekterm, bekendheid, reden, status)
             VALUES ('film_serie', $1, $2, $3, $4, '', '', $5, 3, 'Handmatig toegevoegd; juiste intro/soundtrack nog controleren', 'fout')
             RETURNING id`,
            [type, titel, type, jaar, `${titel} original theme soundtrack intro`]);
        res.json({ ok: true, id: rows[0].id, titel_id:nieuw.rows[0].id, toelichting: 'Toegevoegd aan de database én bovenaan de Swipe-wachtrij zonder MP3.' });
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
