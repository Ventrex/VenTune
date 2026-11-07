// =====================================================================
// Aanvragen vanaf het beginscherm.
//
//   GET  /api/aanvragen/zoek?categorie=film&q=rocky   zoeken bij de bron
//   POST /api/aanvragen                                aanvragen
//   GET  /api/aanvragen/recent                         laatste aanvragen + status
//
// Bronnen: TMDB voor films, series en anime (als er een TMDB-sleutel is),
// iTunes voor muziek, Wikipedia voor videogames (en als reserve). Een
// aanvraag wordt meteen een titel; de AI-curator pakt aanvragen als eerste
// op (beoordelen, MP3 zoeken, hints) en de beheerder keurt het nummer bij
// het swipen.
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const bank = require('../lib/bank');
const tmdb = require('../lib/tmdb');
const itunes = require('../lib/itunes');
const worker = require('../lib/bank-worker');
const { gebruikerUitRequest } = require('../lib/auth');
const logger = require('../lib/logger');

const router = express.Router();
const MUZIEK = new Set(['muziek', 'kerst', 'kinder']);

// Eenvoudige rem: maximaal 30 aanvragen per uur per IP-adres.
const teller = new Map();
function teVeel(ip) {
    const nu = Date.now();
    const lijst = (teller.get(ip) || []).filter((t) => nu - t < 3600 * 1000);
    lijst.push(nu);
    teller.set(ip, lijst);
    return lijst.length > 30;
}

async function wikipedia(term, extra) {
    const params = new URLSearchParams({
        action: 'query', list: 'search', format: 'json', srlimit: '10', srsearch: `${term} ${extra}`.trim(),
    });
    const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'VenTune/1.0 (self-hosted quiz)' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Wikipedia gaf ${r.status}`);
    const data = await r.json();
    return (data.query?.search || []).map((s) => {
        const schoon = String(s.snippet || '').replace(/<[^>]+>/g, '');
        const jaar = Number((schoon.match(/\b(19[5-9]\d|20[0-4]\d)\b/) || [])[1]) || null;
        return {
            extern_id: String(s.pageid),
            naam: String(s.title).replace(/\s*\((?:\d{4} )?(?:video game|film|TV series|song|anime|manga)\)\s*$/i, ''),
            jaar,
            omschrijving: schoon.slice(0, 160),
            bron: 'wikipedia',
        };
    });
}

async function zoekBij(categorie, q) {
    if (MUZIEK.has(categorie)) {
        const lijst = await itunes.zoek(q, { limiet: 12 });
        return lijst.map((r) => ({
            extern_id: r.trackId ? String(r.trackId) : null,
            naam: r.tracknaam, artiest: r.artiest, jaar: r.jaar, poster: r.hoes, bron: 'itunes',
        }));
    }
    if (categorie === 'game') return wikipedia(q, 'video game');
    const type = categorie === 'film' ? 'film' : 'serie';
    if (tmdb.beschikbaar()) {
        const lijst = await tmdb.zoekTitels(q, type);
        return lijst.map((r) => ({
            extern_id: String(r.tmdb_id), naam: r.naam, jaar: r.jaar, poster: r.poster,
            omschrijving: (r.omschrijving || '').slice(0, 160), bron: 'tmdb',
        }));
    }
    return wikipedia(q, categorie === 'film' ? 'film' : categorie === 'anime' ? 'anime' : 'TV series');
}

router.get('/api/aanvragen/zoek', async (req, res) => {
    try {
        const categorie = bank.CATEGORIEEN.includes(req.query.categorie) ? req.query.categorie : 'film';
        const q = String(req.query.q || '').trim();
        if (q.length < 2 || q.length > 120) return res.json({ items: [] });
        const items = (await zoekBij(categorie, q)).filter((i) => i.naam);
        // Staat het er al in?
        const { rows } = await pool.query(
            `SELECT lower(naam) AS n, curatie_status FROM titels
              WHERE COALESCE(categorie, type::text) = $1 AND lower(naam) = ANY($2::text[])`,
            [categorie, items.map((i) => i.naam.toLowerCase())]);
        const al = new Map(rows.map((r) => [r.n, r.curatie_status]));
        res.json({ items: items.map((i) => ({ ...i, al_aanwezig: al.has(i.naam.toLowerCase()) })) });
    } catch (err) {
        logger.waarschuwing('Aanvraag zoeken mislukt', { melding: err.message });
        res.status(502).json({ fout: 'Zoeken lukt nu even niet. Typ de naam zelf in en vraag hem zo aan.' });
    }
});

router.post('/api/aanvragen', async (req, res) => {
    try {
        if (teVeel(req.ip)) return res.status(429).json({ fout: 'Even rustig aan: maximaal 30 aanvragen per uur.' });
        const b = req.body || {};
        const categorie = bank.CATEGORIEEN.includes(b.categorie) ? b.categorie : null;
        const naam = String(b.naam || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!categorie || naam.length < 2) return res.status(400).json({ fout: 'Kies een categorie en vul een naam in.' });
        const jaar = Number.isInteger(Number(b.jaar)) && Number(b.jaar) >= 1900 && Number(b.jaar) <= new Date().getFullYear() + 1 ? Number(b.jaar) : null;
        const artiest = MUZIEK.has(categorie) ? String(b.artiest || '').trim().slice(0, 200) || null : null;
        const gebruiker = await gebruikerUitRequest(req).catch(() => null);
        const door = (gebruiker?.display_naam || String(b.door || '').trim() || 'een speler').slice(0, 60);

        const { rows: bestaand } = await pool.query(
            `SELECT id, curatie_status, uitsluit_reden FROM titels
              WHERE COALESCE(categorie, type::text) = $1 AND lower(naam) = lower($2) LIMIT 1`, [categorie, naam]);
        if (bestaand.length) {
            await pool.query(
                `INSERT INTO aanvragen (titel_id, categorie, naam, jaar, artiest, bron, extern_id, aangevraagd_door, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'bestaat')`,
                [bestaand[0].id, categorie, naam, jaar, artiest, b.bron || null, b.extern_id || null, door]);
            return res.json({ status: 'bestaat', melding: bestaand[0].curatie_status === 'uitgesloten'
                ? `Die staat er al, maar is uitgesloten (${bestaand[0].uitsluit_reden || 'door de beheerder'}).`
                : 'Die staat er al in.' });
        }

        const tmdbId = b.bron === 'tmdb' && /^\d+$/.test(String(b.extern_id || '')) ? Number(b.extern_id) : null;
        const poster = typeof b.poster === 'string' ? b.poster : null;
        const posterPad = poster && /image\.tmdb\.org\/t\/p\/\w+(\/.+)$/.test(poster) ? poster.match(/image\.tmdb\.org\/t\/p\/\w+(\/.+)$/)[1] : null;
        const { rows: [t] } = await pool.query(
            `INSERT INTO titels (naam, type, taal, jaar, categorie, tmdb_id, poster_pad, cover_url, nummer_naam, nummer_artiest,
                    ai_status, curatie_status, toevoeg_reden, handmatig, genres, muziek_genres)
             VALUES ($1, $2::titel_type, 'en', $3, $4, $5, $6, $7, $8, $9, 'nieuw', 'goedgekeurd', $10, ARRAY['categorie'], $11, $11)
             RETURNING id`,
            [naam, bank.typeVoorCategorie(categorie, categorie === 'film' ? 'film' : 'serie'), jaar, categorie, tmdbId,
                posterPad, MUZIEK.has(categorie) ? poster : null, MUZIEK.has(categorie) ? naam : null, artiest,
                `Aanvraag van ${door}`, categorie === 'game' ? ['Videogames'] : []]);
        await pool.query(
            `INSERT INTO aanvragen (titel_id, categorie, naam, jaar, artiest, bron, extern_id, aangevraagd_door)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [t.id, categorie, naam, jaar, artiest, b.bron || 'handmatig', b.extern_id || null, door]);
        await bank.log(t.id, 'aanvulling', `Aanvraag van ${door}: ${naam} (${bank.CATEGORIE_LABEL[categorie]})`);
        worker.porren();
        res.json({ status: 'toegevoegd', melding: 'Aangevraagd! De AI controleert hem en zoekt de muziek.' });
    } catch (err) {
        logger.fout('Aanvraag mislukt', { melding: err.message });
        res.status(500).json({ fout: 'Aanvragen mislukt, probeer het later opnieuw.' });
    }
});

router.get('/api/aanvragen/recent', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT a.id, a.naam, a.categorie, a.aangevraagd_door, a.aangemaakt_op, a.status AS aanvraag_status,
                   t.curatie_status, t.uitsluit_reden, t.ai_status,
                   ${bank.HEEFT_SPEELBAAR} AS speelbaar,
                   ${bank.HEEFT_MP3} AS heeft_mp3
              FROM aanvragen a LEFT JOIN titels t ON t.id = a.titel_id
             ORDER BY a.id DESC LIMIT 30`);
        res.json({ items: rows.map((r) => ({
            id: r.id, naam: r.naam, categorie: r.categorie, door: r.aangevraagd_door, op: r.aangemaakt_op,
            status: r.aanvraag_status === 'bestaat' ? 'Stond er al'
                : r.curatie_status === 'uitgesloten' ? `Niet opgenomen${r.uitsluit_reden ? `: ${r.uitsluit_reden}` : ''}`
                    : r.speelbaar ? 'Speelbaar 🎉'
                        : r.heeft_mp3 ? 'Muziek gevonden, wacht op controle'
                            : r.ai_status === 'klaar' ? 'Muziek wordt gezocht' : 'Wordt gecontroleerd',
        })) });
    } catch (err) { res.status(500).json({ fout: err.message }); }
});

module.exports = router;
