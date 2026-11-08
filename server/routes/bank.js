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
//   GET    /api/admin/bank/collecties             lijst + voortgang
//   POST   /api/admin/bank/collecties             { naam, criteria, soort, doel, emoji }
//   PATCH  /api/admin/bank/collecties/:id         losse velden
//   POST   /api/admin/bank/collecties/:id/opnieuw AI scant alles opnieuw
//   DELETE /api/admin/bank/collecties/:id
//   GET    /api/admin/bank/collecties/:id/leden   ?zoek
//   GET    /api/admin/bank/collecties/:id/zoek    ?q  (titels om toe te voegen)
//   POST   /api/admin/bank/collecties/:id/leden   { titel_id }
//   DELETE /api/admin/bank/collecties/:id/leden/:titelId
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
        const [inst, telling, voorraad, login, swipe] = await Promise.all([
            bank.instellingen(), bank.tellingen(), bank.werkvoorraad(),
            codex.loginStatus().catch(() => ({ loggedIn: false, text: 'Onbekend' })),
            pool.query(`SELECT COALESCE(t.categorie, t.type::text) AS categorie, count(DISTINCT t.id)::int AS n
                          FROM tracks tr JOIN titels t ON t.id = tr.titel_id
                         WHERE tr.wacht_op_swipe AND tr.werkt AND tr.download_status = 'available'
                           AND t.curatie_status <> 'uitgesloten'
                         GROUP BY 1`),
        ]);
        res.json({
            worker: worker.huidigeStatus(),
            instellingen: inst,
            tellingen: telling,
            voorraad,
            swipe: Object.fromEntries(swipe.rows.map((r) => [r.categorie, r.n])),
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

// Na een ChatGPT-limiet meteen weer proberen.
router.post('/api/admin/bank/hervat', vereisAdmin, (_req, res) => {
    worker.hervat();
    res.json({ ok: true });
});

// Eén knop: alles opnieuw beoordelen, alle ontbrekende MP3's (ook opgegeven)
// opnieuw zoeken, onvolledige hints/vragen opnieuw maken en weer aanvullen.
// Handmatige velden blijven staan (die slaat de AI altijd over).
router.post('/api/admin/bank/alles-opnieuw', vereisAdmin, async (_req, res) => {
    try {
        const b = await pool.query(
            "UPDATE titels SET ai_status = 'nieuw' WHERE curatie_status <> 'uitgesloten' OR ai_uitgesloten");
        const m = await pool.query(`
            UPDATE titels t SET zoek_status = 'nieuw', zoek_pogingen = 0, volgende_poging = NULL,
                   zoek_melding = 'Staat in de wachtrij om opnieuw te zoeken.'
             WHERE t.curatie_status <> 'uitgesloten' AND NOT 'mp3' = ANY(t.handmatig) AND NOT ${bank.HEEFT_MP3}`);
        const q = await pool.query(`
            UPDATE titels t SET ai_quiz_op = NULL
             WHERE t.curatie_status <> 'uitgesloten'
               AND (COALESCE(array_length(t.ai_hints, 1), 0) < 3
                    OR (SELECT count(*) FROM vragen v WHERE v.titel_id = t.id AND v.ai_review_status <> 'afgekeurd') < 3)`);
        await bank.bewaarInstellingen({ aan: true });
        worker.hervat({ vergeet: true });
        const tekst = `Alles opnieuw: ${b.rowCount} titels opnieuw beoordelen, ${m.rowCount} MP3's opnieuw zoeken, ${q.rowCount} titels nieuwe hints/vragen.`;
        await bank.log(null, 'systeem', tekst);
        res.json({ ok: true, beoordelen: b.rowCount, mp3: m.rowCount, quiz: q.rowCount, tekst });
    } catch (err) { fout(res, err); }
});

router.patch('/api/admin/bank/instellingen', vereisAdmin, async (req, res) => {
    try {
        const patch = {};
        if (req.body?.doelen && typeof req.body.doelen === 'object') patch.doelen = req.body.doelen;
        if (req.body?.pauzeSeconden !== undefined) patch.pauzeSeconden = req.body.pauzeSeconden;
        if (Array.isArray(req.body?.voorrang)) patch.voorrang = req.body.voorrang;
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
        aanvragen: "t.toevoeg_reden LIKE 'Aanvraag%'",
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
                   t.bekendheid_tier, t.jaar, t.eind_jaar, t.serie_lopend, t.taal::text AS taal, t.land,
                   t.nl_bekend, t.nl_reden, t.franchise, t.aliassen,
                   t.anime_breed_bekend, t.nummer_naam, t.nummer_artiest, t.yt_zoekterm,
                   t.ai_status, t.ai_notitie, t.handmatig, t.curatie_status, t.ai_uitgesloten,
                   t.uitsluit_reden, t.zoek_status, t.zoek_melding, t.zoek_pogingen, t.volgende_poging,
                   t.ai_hints, t.ai_quiz_op,
                   mp.id AS track_id, mp.preview_url AS mp3_url, mp.youtube_titel, mp.bron_url,
                   mp.verificatie_reden, mp.wacht_op_swipe
              FROM titels t
              LEFT JOIN LATERAL (
                  SELECT tr.id, tr.preview_url, tr.youtube_titel, tr.bron_url, tr.verificatie_reden, tr.wacht_op_swipe
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
        if (b.eind_jaar !== undefined) {
            const eind = b.eind_jaar === '' || b.eind_jaar === null ? null : parseInt(b.eind_jaar, 10);
            if (eind !== null && !(eind >= 1900 && eind <= new Date().getFullYear() + 1)) {
                return fout(res, new Error('Ongeldig eindjaar.'), 400);
            }
            set('eind_jaar', eind); vast.push('jaar');
        }
        if (b.serie_lopend !== undefined) {
            set('serie_lopend', !!b.serie_lopend);
            if (b.serie_lopend && b.eind_jaar === undefined) set('eind_jaar', null);
            vast.push('jaar');
        }
        if (b.taal !== undefined) {
            if (!['nl', 'en'].includes(b.taal)) return fout(res, new Error('Kies nl of en.'), 400);
            set('taal', b.taal, '::titel_taal'); vast.push('taal');
        }
        if (b.land !== undefined) {
            set('land', String(b.land).trim().toUpperCase().slice(0, 3) || null); vast.push('taal');
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
        // Waarde en slot in één UPDATE, zodat een lopende AI-vraag het slot
        // altijd ziet zodra de nieuwe waarde er staat.
        waarden.push(vast);
        zetten.push(`handmatig = (SELECT ARRAY(SELECT DISTINCT unnest(handmatig || $${waarden.length}::text[])))`);
        await pool.query(`UPDATE titels SET ${zetten.join(', ')} WHERE id = $1`, waarden);
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
        await zetVast(id, ['vragen']);
        const { rows } = await pool.query(
            `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index, ai_review_status)
             VALUES ($1, 'handmatig', $2, $3, $4, 'goedgekeurd') RETURNING id`,
            [id, v.vraag, JSON.stringify(v.opties), v.correct_index]);
        res.json({ id: rows[0].id });
    } catch (err) { fout(res, err, /verplicht|foute/.test(err.message) ? 400 : 500); }
});

/**
 * Wijzig een vraag onder het rijslot van de titel (hetzelfde slot dat de
 * AI-curator gebruikt). Zo kan een lopende AI-run de vraag niet tussentijds
 * vervangen, en merken we het als hij al verdwenen is.
 */
async function metVraagSlot(vraagId, werk) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: [v] } = await client.query('SELECT titel_id FROM vragen WHERE id = $1', [vraagId]);
        if (!v) { await client.query('ROLLBACK'); return false; }
        await client.query('SELECT id FROM titels WHERE id = $1 FOR UPDATE', [v.titel_id]);
        // Opnieuw kijken: de AI kan de vraag net vervangen hebben.
        const { rowCount } = await client.query('SELECT 1 FROM vragen WHERE id = $1', [vraagId]);
        if (!rowCount) { await client.query('ROLLBACK'); return false; }
        await client.query(
            `UPDATE titels SET handmatig = (SELECT ARRAY(SELECT DISTINCT unnest(handmatig || ARRAY['vragen']))) WHERE id = $1`,
            [v.titel_id]);
        await werk(client);
        await client.query('COMMIT');
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

router.patch('/api/admin/bank/vragen/:id', vereisAdmin, async (req, res) => {
    try {
        const v = vraagUit(req.body);
        // AI-vragen worden 'handmatig', zodat een latere AI-run ze nooit vervangt.
        const gelukt = await metVraagSlot(req.params.id, (client) => client.query(
            `UPDATE vragen SET vraag = $2, opties = $3, correct_index = $4, ai_review_status = 'goedgekeurd',
                    soort = 'handmatig' WHERE id = $1`,
            [req.params.id, v.vraag, JSON.stringify(v.opties), v.correct_index]));
        if (!gelukt) return fout(res, new Error('Deze vraag bestaat niet meer (net door de AI vervangen). Ververs de lijst.'), 404);
        res.json({ ok: true });
    } catch (err) { fout(res, err, /verplicht|foute/.test(err.message) ? 400 : 500); }
});

router.delete('/api/admin/bank/vragen/:id', vereisAdmin, async (req, res) => {
    try {
        await metVraagSlot(req.params.id, (client) => client.query(
            "UPDATE vragen SET ai_review_status = 'afgekeurd' WHERE id = $1", [req.params.id]));
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

// ------------------------------------------------------------------
// Swipen: de MP3's die de AI vond, handmatig goed- of afkeuren.
// Iconisch eerst, daarna algemeen bekend … cult.
// ------------------------------------------------------------------

router.get('/api/admin/bank/swipe', vereisAdmin, async (req, res) => {
    try {
        const params = [];
        const condities = [
            "tr.wacht_op_swipe = true", "tr.werkt = true", "tr.download_status = 'available'",
            "t.curatie_status <> 'uitgesloten'",
        ];
        if (bank.CATEGORIEEN.includes(req.query.categorie)) {
            params.push(req.query.categorie);
            condities.push(`COALESCE(t.categorie, t.type::text) = $${params.length}`);
        }
        const overslaan = String(req.query.overslaan || '').split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger);
        if (overslaan.length) {
            params.push(overslaan);
            condities.push(`NOT (tr.id = ANY($${params.length}::int[]))`);
        }
        const { rows } = await pool.query(`
            SELECT tr.id AS track_id, tr.preview_url AS mp3_url, tr.youtube_titel, tr.bron_url,
                   tr.verificatie_reden, t.id, t.naam, COALESCE(t.categorie, t.type::text) AS categorie,
                   t.bekendheid_tier, t.jaar, t.eind_jaar, t.serie_lopend, t.nummer_naam, t.nummer_artiest, t.franchise
              FROM tracks tr JOIN titels t ON t.id = tr.titel_id
             WHERE ${condities.join(' AND ')}
             ORDER BY (COALESCE(t.categorie, t.type::text) = ANY($${params.length + 1}::text[])) DESC, ${bank.TIER_RANG}, tr.id
             LIMIT 15`, [...params, (await bank.instellingen()).voorrang || []]);
        const { rows: tel } = await pool.query(`
            SELECT COALESCE(t.categorie, t.type::text) AS categorie, count(*)::int AS n
              FROM tracks tr JOIN titels t ON t.id = tr.titel_id
             WHERE tr.wacht_op_swipe AND tr.werkt AND tr.download_status = 'available'
               AND t.curatie_status <> 'uitgesloten'
             GROUP BY 1`);
        res.json({ items: rows, tellingen: Object.fromEntries(tel.map((r) => [r.categorie, r.n])) });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/swipe/:trackId', vereisAdmin, async (req, res) => {
    try {
        const keuze = req.body?.keuze;
        if (!['goed', 'fout', 'uitsluiten'].includes(keuze)) return fout(res, new Error('Kies goed, fout of uitsluiten.'), 400);
        const { rows: [tr] } = await pool.query(
            `SELECT tr.id, tr.titel_id, tr.wacht_op_swipe, t.naam FROM tracks tr JOIN titels t ON t.id = tr.titel_id
              WHERE tr.id = $1`, [req.params.trackId]);
        if (!tr) return fout(res, new Error('Nummer niet gevonden.'), 404);
        // Dubbel tikken of een herhaalde aanvraag doet niets extra.
        if (!tr.wacht_op_swipe) return res.json({ ok: true, alGedaan: true });
        if (keuze === 'goed') {
            await pool.query(
                `UPDATE tracks SET wacht_op_swipe = false, review_status = 'goedgekeurd', review_handmatig = true,
                        gecontroleerd = true, bevestigd = true, review_laatste_op = now(),
                        review_reden = 'Goedgekeurd bij swipen' WHERE id = $1`, [tr.id]);
            await bank.log(tr.titel_id, 'mp3', `${tr.naam}: nummer goedgekeurd bij swipen.`);
        } else if (keuze === 'fout') {
            await bankMp3.keurAf(tr.titel_id, 'Afgekeurd bij swipen');
            await pool.query('UPDATE tracks SET wacht_op_swipe = false WHERE id = $1', [tr.id]);
            worker.porren();
        } else {
            await pool.query(
                `UPDATE titels SET curatie_status = 'uitgesloten', ai_uitgesloten = false,
                        uitsluit_reden = 'Uitgesloten bij swipen',
                        handmatig = (SELECT ARRAY(SELECT DISTINCT unnest(handmatig || ARRAY['actief'])))
                  WHERE id = $1`, [tr.titel_id]);
            await pool.query('UPDATE tracks SET wacht_op_swipe = false, werkt = false WHERE id = $1', [tr.id]);
            await bank.log(tr.titel_id, 'uitgesloten', `${tr.naam}: uit het spel gehaald bij swipen.`);
        }
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

// ------------------------------------------------------------------
// Collecties (Sinterklaas, Rock, Disney …)
// ------------------------------------------------------------------

const SOORTEN = ['muziek', 'beide', 'film', 'serie', 'alles'];

function slug(naam) {
    return String(naam || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'collectie';
}

router.get('/api/admin/bank/collecties', vereisAdmin, async (_req, res) => {
    try {
        const { rows: [{ max }] } = await pool.query('SELECT COALESCE(max(id), 0)::int AS max FROM titels');
        const { rows } = await pool.query(`
            SELECT c.id, c.sleutel, c.naam, c.emoji, c.beschrijving, c.ai_criteria, c.standaard_type, c.actief,
                   c.ai_aan, c.ai_doel, c.ai_scan_tot, c.voorrang, c.ai_laatst, c.ai_uitgeput_tot,
                   count(tc.titel_id)::int AS aantal,
                   count(tc.titel_id) FILTER (WHERE ${bank.HEEFT_SPEELBAAR.replace(/\bt\.id\b/g, 'tc.titel_id')})::int AS speelbaar,
                   count(tc.titel_id) FILTER (WHERE tc.bron = 'ai')::int AS door_ai
              FROM collecties c LEFT JOIN titel_collecties tc ON tc.collectie_id = c.id
             GROUP BY c.id
             ORDER BY c.voorrang DESC, c.actief DESC, c.naam`);
        res.json({
            items: rows.map((c) => ({ ...c, scan_klaar: c.ai_scan_tot >= max, scan_procent: max ? Math.min(100, Math.round((c.ai_scan_tot / max) * 100)) : 100 })),
        });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/collecties', vereisAdmin, async (req, res) => {
    try {
        const naam = String(req.body?.naam || '').trim().slice(0, 60);
        if (!naam) return res.status(400).json({ fout: 'Geef de collectie een naam.' });
        const soort = SOORTEN.includes(req.body?.soort) ? req.body.soort : 'muziek';
        const doel = Math.max(0, Math.min(1000, Number(req.body?.doel) || 60));
        const criteria = String(req.body?.criteria || '').trim().slice(0, 600) || null;
        const emoji = String(req.body?.emoji || '').trim().slice(0, 8) || null;
        let sleutel = slug(naam);
        const { rows: dubbel } = await pool.query('SELECT sleutel FROM collecties WHERE sleutel LIKE $1', [`${sleutel}%`]);
        const bezet = new Set(dubbel.map((d) => d.sleutel));
        for (let i = 2; bezet.has(sleutel); i++) sleutel = `${slug(naam)}-${i}`;
        const { rows: [c] } = await pool.query(
            `INSERT INTO collecties (sleutel, naam, beschrijving, ai_criteria, standaard_type, emoji, ai_doel, ai_aan, actief, toevoeg_reden)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, 'Aangemaakt in Beheer; de AI deelt in en vult aan.') RETURNING *`,
            [sleutel, naam, criteria || naam, criteria, soort, emoji, doel]);
        await bank.log(null, 'collectie', `Nieuwe collectie "${naam}" — de AI gaat bestaande titels indelen en aanvullen tot ${doel}.`);
        worker.porren();
        res.json(c);
    } catch (err) { fout(res, err); }
});

router.patch('/api/admin/bank/collecties/:id', vereisAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const zetten = [];
        const waarden = [Number(req.params.id)];
        const set = (k, v) => { waarden.push(v); zetten.push(`${k} = $${waarden.length}`); };
        let opnieuw = false;
        if (b.naam !== undefined) { const n = String(b.naam).trim().slice(0, 60); if (n) set('naam', n); }
        if (b.emoji !== undefined) set('emoji', String(b.emoji).trim().slice(0, 8) || null);
        if (b.ai_criteria !== undefined) { set('ai_criteria', String(b.ai_criteria).trim().slice(0, 600) || null); opnieuw = true; }
        if (b.standaard_type !== undefined && SOORTEN.includes(b.standaard_type)) { set('standaard_type', b.standaard_type); opnieuw = true; }
        if (b.ai_doel !== undefined) { set('ai_doel', Math.max(0, Math.min(1000, Number(b.ai_doel) || 0))); zetten.push('ai_uitgeput_tot = NULL'); }
        for (const k of ['actief', 'ai_aan', 'voorrang']) if (typeof b[k] === 'boolean') set(k, b[k]);
        if (opnieuw) zetten.push('ai_scan_tot = 0', 'ai_uitgeput_tot = NULL');
        if (!zetten.length) return res.status(400).json({ fout: 'Niets om op te slaan.' });
        const { rows: [c] } = await pool.query(`UPDATE collecties SET ${zetten.join(', ')} WHERE id = $1 RETURNING *`, waarden);
        if (!c) return res.status(404).json({ fout: 'Collectie niet gevonden.' });
        worker.porren();
        res.json(c);
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/collecties/:id/opnieuw', vereisAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE collecties SET ai_scan_tot = 0, ai_uitgeput_tot = NULL, ai_aan = true WHERE id = $1', [Number(req.params.id)]);
        worker.porren();
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

router.delete('/api/admin/bank/collecties/:id', vereisAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM collecties WHERE id = $1', [Number(req.params.id)]);
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

router.get('/api/admin/bank/collecties/:id/leden', vereisAdmin, async (req, res) => {
    try {
        const zoek = String(req.query.zoek || '').trim();
        const { rows } = await pool.query(`
            SELECT t.id, t.naam, t.jaar, COALESCE(t.categorie, t.type::text) AS categorie, t.bekendheid_tier,
                   t.nummer_naam, t.nummer_artiest, tc.bron, ${bank.HEEFT_SPEELBAAR} AS speelbaar
              FROM titel_collecties tc JOIN titels t ON t.id = tc.titel_id
             WHERE tc.collectie_id = $1 AND ($2 = '' OR t.naam ILIKE '%' || $2 || '%' OR t.nummer_naam ILIKE '%' || $2 || '%')
             ORDER BY ${bank.TIER_RANG}, t.naam LIMIT 400`, [Number(req.params.id), zoek]);
        res.json({ items: rows });
    } catch (err) { fout(res, err); }
});

router.get('/api/admin/bank/collecties/:id/zoek', vereisAdmin, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ items: [] });
        const { rows } = await pool.query(`
            SELECT t.id, t.naam, t.jaar, COALESCE(t.categorie, t.type::text) AS categorie, t.nummer_naam, t.nummer_artiest
              FROM titels t
             WHERE (t.naam ILIKE '%' || $2 || '%' OR t.nummer_naam ILIKE '%' || $2 || '%')
               AND NOT EXISTS (SELECT 1 FROM titel_collecties tc WHERE tc.titel_id = t.id AND tc.collectie_id = $1)
             ORDER BY (lower(t.naam) = lower($2)) DESC, ${bank.TIER_RANG}, t.naam LIMIT 20`, [Number(req.params.id), q]);
        res.json({ items: rows });
    } catch (err) { fout(res, err); }
});

router.post('/api/admin/bank/collecties/:id/leden', vereisAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const titelId = Number(req.body?.titel_id);
        if (!Number.isInteger(titelId)) return res.status(400).json({ fout: 'Kies een titel.' });
        await pool.query('DELETE FROM titel_collecties_uit WHERE titel_id = $1 AND collectie_id = $2', [titelId, id]);
        await pool.query(
            `INSERT INTO titel_collecties (titel_id, collectie_id, bron) VALUES ($1, $2, 'handmatig')
             ON CONFLICT (titel_id, collectie_id) DO UPDATE SET bron = 'handmatig'`, [titelId, id]);
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

router.delete('/api/admin/bank/collecties/:id/leden/:titelId', vereisAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const titelId = Number(req.params.titelId);
        await pool.query('DELETE FROM titel_collecties WHERE titel_id = $1 AND collectie_id = $2', [titelId, id]);
        // Zelf weggehaald: de AI zet hem er niet meer in.
        await pool.query('INSERT INTO titel_collecties_uit (titel_id, collectie_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [titelId, id]);
        res.json({ ok: true });
    } catch (err) { fout(res, err); }
});

module.exports = router;
