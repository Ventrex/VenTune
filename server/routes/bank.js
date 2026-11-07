// =====================================================================
// Beheer 2.0 — admin-API voor de vragenbank (/admin/bank).
//
//   GET    /api/admin/bank/status                 overzicht + worker
//   POST   /api/admin/bank/worker                 { aan }
//   PATCH  /api/admin/bank/instellingen           { doelen, pauzeSeconden }
//   POST   /api/admin/bank/doel/:categorie        { erbij }
//   GET    /api/admin/bank/items                  ?tab&categorie&tier&zoek&filter&pagina
//   POST   /api/admin/bank/items                  { naam, categorie }
//   PATCH  /api/admin/bank/items/:id              losse velden
//   POST   /api/admin/bank/items/:id/ai           { wat: alles|quiz|mp3 }
//   POST   /api/admin/bank/items/:id/vrijgeven    { veld }
//   POST   /api/admin/bank/items/:id/mp3/url      { url }
//   POST   /api/admin/bank/items/:id/mp3/afkeuren
//   POST   /api/admin/bank/items/:id/vragen       { vraag, juist, fout }
//   PATCH  /api/admin/bank/vragen/:id             { vraag, juist, fout }
//   DELETE /api/admin/bank/vragen/:id
//   GET    /api/admin/bank/log                    ?soort&pagina
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const codex = require('../lib/codex');
const bank = require('../lib/bank');
const bankMp3 = require('../lib/bank-mp3');
const worker = require('../lib/bank-worker');
const { vereisAdmin } = require('./admin');

const router = express.Router();
const PER_PAGINA = 50;

const fout = (res, err, code = 500) => res.status(code).json({ fout: err.message || String(err) });

router.get('/api/admin/bank/status', vereisAdmin, async (_req, res) => {
    try {
        const [inst, telling, voorraad, login] = await Promise.all([
            bank.instellingen(), bank.tellingen(), bank.werkvoorraad(),
            codex.loginStatus().catch(() => ({ loggedIn: false, text: 'Onbekend' })),
        ]);
        res.json({
            worker: worker.huidigeStatus(),
            instellingen: inst,
            tellingen: telling,
            voorraad,
            chatgpt: { gekoppeld: !!login.loggedIn, tekst: login.text || '' },
            categorieen: bank.CATEGORIEEN.map((c) => ({ id: c, naam: bank.CATEGORIE_LABEL[c] })),
            tiers: bank.TIERS.map((t) => ({ id: t, naam: bank.TIER_LABEL[t] })),
        });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/worker', vereisAdmin, async (req, res) => {
    try {
        const inst = await bank.bewaarInstellingen({ aan: req.body?.aan !== false });
        await bank.log(null, 'systeem', inst.aan ? 'AI-curator aangezet.' : 'AI-curator uitgezet.');
        worker.porren();
        res.json(inst);
    } catch (err) { fout(res, err); }
});

router.patch('/api/admin/bank/instellingen', vereisAdmin, async (req, res) => {
    try {
        const patch = {};
        if (req.body?.doelen && typeof req.body.doelen === 'object') patch.doelen = req.body.doelen;
        if (req.body?.pauzeSeconden !== undefined) patch.pauzeSeconden = req.body.pauzeSeconden;
        res.json(await bank.bewaarInstellingen(patch));
        worker.porren();
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/doel/:categorie', vereisAdmin, async (req, res) => {
    try {
        const c = req.params.categorie;
        if (!bank.CATEGORIEEN.includes(c)) return fout(res, new Error('Onbekende categorie.'), 400);
        const erbij = Math.min(5000, Math.max(1, parseInt(req.body?.erbij, 10) || 0));
        const [inst, telling] = await Promise.all([bank.instellingen(), bank.tellingen()]);
        const nieuw = Math.max(inst.doelen[c] || 0, telling[c].totaal) + erbij;
        const opgeslagen = await bank.bewaarInstellingen({ doelen: { [c]: nieuw } });
        await bank.log(null, 'systeem', `Doel ${bank.CATEGORIE_LABEL[c]} verhoogd naar ${nieuw} (+${erbij}).`);
        worker.porren();
        res.json(opgeslagen);
    } catch (err) { fout(res, err); }
});

// ------------------------------------------------------------------
// Lijsten per tab
// ------------------------------------------------------------------

const FILTERS = {
    nummers: {
        alle: "t.curatie_status <> 'uitgesloten'",
        te_beoordelen: "t.curatie_status <> 'uitgesloten' AND (t.ai_status <> 'klaar' OR t.ai_versie < " + bank.AI_VERSIE + ')',
        handmatig: "cardinality(t.handmatig) > 0",
        uitgesloten: "t.curatie_status = 'uitgesloten'",
    },
    mp3: {
        mist: `t.curatie_status <> 'uitgesloten' AND NOT ${bank.HEEFT_MP3}`,
        opgegeven: `t.curatie_status <> 'uitgesloten' AND NOT ${bank.HEEFT_MP3} AND t.zoek_status = 'opgegeven'`,
        aanwezig: `t.curatie_status <> 'uitgesloten' AND ${bank.HEEFT_MP3}`,
        alle: "t.curatie_status <> 'uitgesloten'",
    },
    hints: {
        leeg: "t.curatie_status <> 'uitgesloten' AND COALESCE(array_length(t.ai_hints, 1), 0) < 3",
        alle: "t.curatie_status <> 'uitgesloten'",
    },
    vragen: {
        leeg: `t.curatie_status <> 'uitgesloten' AND (SELECT count(*) FROM vragen v WHERE v.titel_id = t.id
                 AND v.ai_review_status <> 'afgekeurd') < 3`,
        alle: "t.curatie_status <> 'uitgesloten'",
    },
    jaartal: {
        alle: "t.curatie_status <> 'uitgesloten'",
        leeg: "t.curatie_status <> 'uitgesloten' AND t.jaar IS NULL",
    },
    nl: {
        nee: "t.nl_bekend = 'nee'",
        twijfel: "t.nl_bekend = 'twijfel'",
        ja: "t.nl_bekend = 'ja'",
        uitgesloten: "t.curatie_status = 'uitgesloten'",
        alle: 'true',
    },
    antwoorden: {
        alle: "t.curatie_status <> 'uitgesloten'",
        zonder_franchise: "t.curatie_status <> 'uitgesloten' AND COALESCE(t.franchise, '') = ''",
        anime: "t.curatie_status <> 'uitgesloten' AND t.categorie = 'anime'",
    },
};

router.get('/api/admin/bank/items', vereisAdmin, async (req, res) => {
    try {
        const tab = FILTERS[req.query.tab] ? req.query.tab : 'nummers';
        const filterNaam = FILTERS[tab][req.query.filter] ? req.query.filter : Object.keys(FILTERS[tab])[0];
        const condities = [FILTERS[tab][filterNaam]];
        const params = [];
        if (bank.CATEGORIEEN.includes(req.query.categorie)) {
            params.push(req.query.categorie);
            condities.push(`COALESCE(t.categorie, t.type::text) = $${params.length}`);
        }
        if (bank.TIERS.includes(req.query.tier)) {
            params.push(req.query.tier);
            condities.push(`t.bekendheid_tier = $${params.length}`);
        } else if (req.query.tier === 'geen') {
            condities.push('t.bekendheid_tier IS NULL');
        }
        const zoek = String(req.query.zoek || '').trim();
        if (zoek) {
            params.push(`%${zoek}%`);
            condities.push(`(t.naam ILIKE $${params.length} OR t.nummer_naam ILIKE $${params.length}
                OR t.nummer_artiest ILIKE $${params.length} OR t.franchise ILIKE $${params.length})`);
        }
        const where = `WHERE ${condities.join(' AND ')}`;
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        const sortering = tab === 'mp3' && filterNaam !== 'aanwezig'
            ? `${bank.TIER_RANG}, t.zoek_pogingen DESC, t.naam`
            : `${bank.TIER_RANG}, t.naam`;

        const { rows: [{ totaal }] } = await pool.query(`SELECT count(*)::int AS totaal FROM titels t ${where}`, params);
        params.push(PER_PAGINA, (pagina - 1) * PER_PAGINA);
        const { rows } = await pool.query(`
            SELECT t.id, t.naam, t.type::text AS type, COALESCE(t.categorie, t.type::text) AS categorie,
                   t.bekendheid_tier, t.jaar, t.nl_bekend, t.nl_reden, t.franchise, t.aliassen,
                   t.anime_breed_bekend, t.nummer_naam, t.nummer_artiest, t.yt_zoekterm,
                   t.ai_status, t.ai_notitie, t.handmatig, t.curatie_status, t.ai_uitgesloten,
                   t.uitsluit_reden, t.zoek_status, t.zoek_melding, t.zoek_pogingen, t.volgende_poging,
                   t.ai_hints, t.ai_quiz_op,
                   mp.id AS track_id, mp.preview_url AS mp3_url, mp.youtube_titel, mp.bron_url,
                   mp.verificatie_reden
              FROM titels t
              LEFT JOIN LATERAL (
                  SELECT tr.id, tr.preview_url, tr.youtube_titel, tr.bron_url, tr.verificatie_reden
                    FROM tracks tr
                   WHERE tr.titel_id = t.id AND tr.werkt = true AND tr.bron = 'lokaal'
                     AND tr.download_status = 'available'
                   ORDER BY tr.review_handmatig DESC, tr.id DESC LIMIT 1) mp ON true
              ${where}
             ORDER BY ${sortering}
             LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

        if (tab === 'vragen' && rows.length) {
            const { rows: vragen } = await pool.query(
                `SELECT id, titel_id, soort, vraag, opties, correct_index, ai_review_status
                   FROM vragen WHERE titel_id = ANY($1) AND ai_review_status <> 'afgekeurd'
                  ORDER BY titel_id, (soort = 'ai') DESC, id`, [rows.map((r) => r.id)]);
            const per = new Map();
            for (const v of vragen) {
                const opties = Array.isArray(v.opties) ? v.opties : [];
                const juist = opties[v.correct_index] ?? '';
                const item = { id: v.id, soort: v.soort, vraag: v.vraag, juist, fout: opties.filter((_, i) => i !== v.correct_index) };
                if (!per.has(v.titel_id)) per.set(v.titel_id, []);
                per.get(v.titel_id).push(item);
            }
            for (const r of rows) r.vragen = per.get(r.id) || [];
        }
        const bezig = new Set(bankMp3.bezigeIds());
        for (const r of rows) r.mp3_bezig = bezig.has(r.id);
        res.json({ totaal, pagina, perPagina: PER_PAGINA, filter: filterNaam, filters: Object.keys(FILTERS[tab]), items: rows });
    } catch (err) { fout(res, err); }
});

// ------------------------------------------------------------------
// Bewerken
// ------------------------------------------------------------------

async function zetVast(id, velden) {
    if (!velden.length) return;
    await pool.query(
        `UPDATE titels SET handmatig = (SELECT ARRAY(SELECT DISTINCT unnest(handmatig || $2::text[]))) WHERE id = $1`,
        [id, velden]);
}

function lijst(waarde) {
    if (Array.isArray(waarde)) return waarde.map((x) => String(x).trim()).filter(Boolean);
    return String(waarde || '').split(',').map((x) => x.trim()).filter(Boolean);
}

router.post('/api/admin/bank/items', vereisAdmin, async (req, res) => {
    try {
        const naam = String(req.body?.naam || '').trim().slice(0, 200);
        const categorie = bank.CATEGORIEEN.includes(req.body?.categorie) ? req.body.categorie : 'film';
        if (!naam) return fout(res, new Error('Naam is verplicht.'), 400);
        const { rows } = await pool.query(
            `INSERT INTO titels (naam, type, taal, categorie, curatie_status, ai_status, toevoeg_reden, handmatig)
             VALUES ($1, $2::titel_type, 'en', $3, 'goedgekeurd', 'nieuw', 'Handmatig toegevoegd in beheer', ARRAY['categorie','actief'])
             RETURNING id`, [naam, bank.typeVoorCategorie(categorie, 'film'), categorie]);
        await bank.log(rows[0].id, 'systeem', `Handmatig toegevoegd: ${naam} (${bank.CATEGORIE_LABEL[categorie]}); AI vult de rest aan.`);
        worker.porren();
        res.json({ id: rows[0].id });
    } catch (err) { fout(res, err); }
});

router.patch('/api/admin/bank/items/:id', vereisAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { rows: [t] } = await pool.query('SELECT id, type::text AS type, curatie_status, handmatig FROM titels WHERE id = $1', [id]);
        if (!t) return fout(res, new Error('Titel niet gevonden.'), 404);
        const b = req.body || {};
        const zetten = [];
        const waarden = [id];
        const vast = [];
        const set = (kolom, waarde, cast = '') => { waarden.push(waarde); zetten.push(`${kolom} = $${waarden.length}${cast}`); };

        if (b.naam !== undefined) {
            const naam = String(b.naam).trim().slice(0, 200);
            if (!naam) return fout(res, new Error('Naam mag niet leeg zijn.'), 400);
            set('naam', naam); vast.push('naam');
        }
        if (b.categorie !== undefined) {
            if (!bank.CATEGORIEEN.includes(b.categorie)) return fout(res, new Error('Onbekende categorie.'), 400);
            set('categorie', b.categorie);
            set('type', bank.typeVoorCategorie(b.categorie, t.type), '::titel_type');
            vast.push('categorie');
        }
        if (b.bekendheid_tier !== undefined) {
            if (!bank.TIERS.includes(b.bekendheid_tier)) return fout(res, new Error('Onbekend bekendheidsniveau.'), 400);
            set('bekendheid_tier', b.bekendheid_tier); vast.push('tier');
        }
        if (b.jaar !== undefined) {
            const jaar = b.jaar === '' || b.jaar === null ? null : parseInt(b.jaar, 10);
            if (jaar !== null && !(jaar >= 1900 && jaar <= new Date().getFullYear() + 1)) {
                return fout(res, new Error('Ongeldig jaartal.'), 400);
            }
            set('jaar', jaar); vast.push('jaar');
        }
        if (b.nl_bekend !== undefined) {
            if (!['ja', 'nee', 'twijfel'].includes(b.nl_bekend)) return fout(res, new Error('Kies ja, nee of twijfel.'), 400);
            set('nl_bekend', b.nl_bekend); vast.push('nl');
            if (b.nl_bekend === 'nee') {
                set('curatie_status', 'uitgesloten'); set('uitsluit_reden', 'Niet bekend in Nederland (beheerder)');
            } else if (t.curatie_status === 'uitgesloten') {
                set('curatie_status', 'goedgekeurd'); set('uitsluit_reden', null); set('ai_uitgesloten', false);
            }
        }
        if (b.actief !== undefined) {
            set('curatie_status', b.actief ? 'goedgekeurd' : 'uitgesloten');
            set('uitsluit_reden', b.actief ? null : 'Uitgesloten door beheerder');
            set('ai_uitgesloten', false);
            vast.push('actief');
        }
        if (b.franchise !== undefined) { set('franchise', String(b.franchise).trim().slice(0, 120) || null); vast.push('franchise'); }
        if (b.aliassen !== undefined) { set('aliassen', lijst(b.aliassen).slice(0, 10)); vast.push('aliassen'); }
        if (b.anime_breed_bekend !== undefined) { set('anime_breed_bekend', !!b.anime_breed_bekend); vast.push('categorie'); }
        if (b.nummer_naam !== undefined || b.nummer_artiest !== undefined || b.yt_zoekterm !== undefined) {
            if (b.nummer_naam !== undefined) set('nummer_naam', String(b.nummer_naam).trim().slice(0, 200) || null);
            if (b.nummer_artiest !== undefined) set('nummer_artiest', String(b.nummer_artiest).trim().slice(0, 200) || null);
            if (b.yt_zoekterm !== undefined) set('yt_zoekterm', String(b.yt_zoekterm).trim().slice(0, 200) || null);
            vast.push('nummer');
        }
        if (b.hints !== undefined) {
            const hints = (Array.isArray(b.hints) ? b.hints : []).map((h) => String(h || '').trim().slice(0, 220));
            set('ai_hints', hints.filter(Boolean));
            zetten.push("ai_hints_status = 'goedgekeurd'");
            vast.push('hints');
        }
        if (!zetten.length) return fout(res, new Error('Niets om op te slaan.'), 400);
        await pool.query(`UPDATE titels SET ${zetten.join(', ')} WHERE id = $1`, waarden);
        await zetVast(id, vast);
        res.json({ ok: true, vast });
    } catch (err) {
        if (/unique|duplicate/i.test(err.message)) return fout(res, new Error('Die naam bestaat al.'), 409);
        fout(res, err);
    }
});

router.post('/api/admin/bank/items/:id/vrijgeven', vereisAdmin, async (req, res) => {
    try {
        const veld = String(req.body?.veld || '');
        if (!bank.VASTZETBAAR.includes(veld) && veld !== 'alles') return fout(res, new Error('Onbekend veld.'), 400);
        if (veld === 'alles') {
            await pool.query("UPDATE titels SET handmatig = '{}', ai_status = 'nieuw' WHERE id = $1", [req.params.id]);
        } else {
            await pool.query("UPDATE titels SET handmatig = array_remove(handmatig, $2), ai_status = 'nieuw' WHERE id = $1",
                [req.params.id, veld]);
        }
        worker.porren();
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/items/:id/ai', vereisAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const wat = req.body?.wat;
        if (wat === 'quiz') {
            await pool.query(
                "UPDATE titels SET ai_quiz_op = NULL, handmatig = array_remove(array_remove(handmatig, 'hints'), 'vragen') WHERE id = $1",
                [id]);
        } else if (wat === 'mp3') {
            await bankMp3.zoekOpnieuw(id);
        } else {
            await pool.query("UPDATE titels SET ai_status = 'nieuw' WHERE id = $1", [id]);
        }
        await bank.log(id, 'systeem', `Beheerder vroeg de AI om ${wat === 'quiz' ? 'nieuwe hints en vragen' : wat === 'mp3' ? 'opnieuw een MP3 te zoeken' : 'een nieuwe beoordeling'}.`);
        worker.porren();
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/items/:id/mp3/url', vereisAdmin, async (req, res) => {
    try { res.json(await bankMp3.plaatsEigenUrl(parseInt(req.params.id, 10), req.body?.url)); }
    catch (err) { fout(res, err, 400); }
});

router.post('/api/admin/bank/items/:id/mp3/afkeuren', vereisAdmin, async (req, res) => {
    try {
        const r = await bankMp3.keurAf(parseInt(req.params.id, 10), 'Afgekeurd door beheerder');
        worker.porren();
        res.json(r);
    } catch (err) { fout(res, err); }
});

// ------------------------------------------------------------------
// Bonusvragen
// ------------------------------------------------------------------

function vraagUit(body) {
    const vraag = String(body?.vraag || '').trim().slice(0, 240);
    const juist = String(body?.juist || '').trim().slice(0, 120);
    const foutLijst = [...new Set(lijst(body?.fout))].filter((f) => f.toLowerCase() !== juist.toLowerCase()).slice(0, 5);
    if (!vraag || !juist) throw new Error('Vraag en goed antwoord zijn verplicht.');
    if (foutLijst.length < 5) throw new Error('Geef 5 foute antwoorden (gescheiden door komma’s).');
    const opties = [juist, ...foutLijst];
    for (let i = opties.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opties[i], opties[j]] = [opties[j], opties[i]];
    }
    return { vraag, opties, correct_index: opties.indexOf(juist) };
}

router.post('/api/admin/bank/items/:id/vragen', vereisAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const v = vraagUit(req.body);
        const { rows } = await pool.query(
            `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index, ai_review_status)
             VALUES ($1, 'handmatig', $2, $3, $4, 'goedgekeurd') RETURNING id`,
            [id, v.vraag, JSON.stringify(v.opties), v.correct_index]);
        await zetVast(id, ['vragen']);
        res.json({ id: rows[0].id });
    } catch (err) { fout(res, err, /verplicht|foute/.test(err.message) ? 400 : 500); }
});

router.patch('/api/admin/bank/vragen/:id', vereisAdmin, async (req, res) => {
    try {
        const v = vraagUit(req.body);
        const { rows } = await pool.query(
            `UPDATE vragen SET vraag = $2, opties = $3, correct_index = $4, ai_review_status = 'goedgekeurd'
              WHERE id = $1 RETURNING titel_id`,
            [req.params.id, v.vraag, JSON.stringify(v.opties), v.correct_index]);
        if (!rows.length) return fout(res, new Error('Vraag niet gevonden.'), 404);
        await zetVast(rows[0].titel_id, ['vragen']);
        res.json({ ok: true });
    } catch (err) { fout(res, err, /verplicht|foute/.test(err.message) ? 400 : 500); }
});

router.delete('/api/admin/bank/vragen/:id', vereisAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            "UPDATE vragen SET ai_review_status = 'afgekeurd' WHERE id = $1 RETURNING titel_id", [req.params.id]);
        if (rows.length) await zetVast(rows[0].titel_id, ['vragen']);
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

// ------------------------------------------------------------------
// Logboek
// ------------------------------------------------------------------

router.get('/api/admin/bank/log', vereisAdmin, async (req, res) => {
    try {
        const params = [];
        let where = '';
        const soorten = ['beoordeling', 'uitgesloten', 'quiz', 'mp3', 'aanvulling', 'verbeterpunt', 'fout', 'systeem'];
        if (soorten.includes(req.query.soort)) { params.push(req.query.soort); where = 'WHERE l.soort = $1'; }
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        params.push(100, (pagina - 1) * 100);
        const { rows } = await pool.query(`
            SELECT l.id, l.soort, l.bericht, l.aangemaakt_op, l.titel_id, t.naam
              FROM bank_log l LEFT JOIN titels t ON t.id = l.titel_id
              ${where}
             ORDER BY l.id DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        res.json({ items: rows, pagina, soorten });
    } catch (err) { fout(res, err); }
});

module.exports = router;
