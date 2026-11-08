// =====================================================================
// Aanvragen vanaf het beginscherm.
//
//   GET  /api/aanvragen/zoek?categorie=film&q=rocky   zoeken bij de bron
//   POST /api/aanvragen                                aanvragen
//   GET  /api/aanvragen/recent                         laatste aanvragen + status
//
// Alleen geregistreerde spelers (of de beheerder) kunnen toevoegen.
// Bronnen: TMDB voor films, series en anime, IGDB voor videogames (met
// IGDB_CLIENT_ID/SECRET), iTunes + Discogs (met DISCOGS_TOKEN) voor muziek,
// en Wikipedia als reserve. Genres van de bron gaan meteen mee. Een
// aanvraag wordt meteen een titel; de AI-curator pakt aanvragen als eerste
// op (beoordelen, MP3 zoeken, hints) en de beheerder keurt het nummer bij
// het swipen.
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const bank = require('../lib/bank');
const tmdb = require('../lib/tmdb');
const itunes = require('../lib/itunes');
const igdb = require('../lib/igdb');
const discogs = require('../lib/discogs');
const worker = require('../lib/bank-worker');
const { gebruikerUitRequest } = require('../lib/auth');
const { isIngelogd: isAdmin } = require('./admin');
const logger = require('../lib/logger');

const router = express.Router();

// TMDB-genre-id's naar VenTune-genres.
const TMDB_GENRE = {
    28: ['Actie'], 12: ['Avontuur'], 16: ['Animatie'], 35: ['Komedie'], 80: ['Misdaad'], 99: ['Documentaire'],
    18: ['Drama'], 10751: ['Familie'], 14: ['Fantasy'], 36: ['Historisch'], 27: ['Horror'], 10402: ['Musical'],
    9648: ['Mysterie'], 10749: ['Romantiek'], 878: ['Sciencefiction'], 53: ['Thriller'], 10752: ['Oorlog'],
    37: ['Western'], 10759: ['Actie', 'Avontuur'], 10762: ['Kinderserie'], 10765: ['Sciencefiction', 'Fantasy'],
    10768: ['Oorlog'],
};

/** Ingelogde speler of beheerder; anders null. */
async function wie(req) {
    const gebruiker = await gebruikerUitRequest(req).catch(() => null);
    if (gebruiker) return { id: gebruiker.id, naam: gebruiker.display_naam || gebruiker.gebruikersnaam };
    try { if (isAdmin(req)) return { id: null, naam: 'Beheer' }; } catch { /* niet ingelogd */ }
    return null;
}

router.get('/api/aanvragen/wie', async (req, res) => {
    const w = await wie(req);
    res.json({ ingelogd: !!w, naam: w?.naam || null, bronnen: {
        tmdb: tmdb.beschikbaar(), igdb: igdb.beschikbaar(), discogs: discogs.beschikbaar(),
    } });
});
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

const GENRE_ITUNES = {
    'Hip-Hop/Rap': 'Hiphop', 'R&B/Soul': 'R&B', Dance: 'Dance', Electronic: 'Dance', Alternative: 'Alternatief',
    'Singer/Songwriter': 'Singer-songwriter', Soundtrack: 'Soundtrack', "Children's Music": 'Kinderlied',
    Christmas: 'Kerst', Holiday: 'Kerst', 'Hard Rock': 'Rock', Classical: 'Klassiek', 'Nederlandstalig': 'Nederpop',
    'Nederlandse muziek': 'Nederpop', 'Hip Hop/Rap': 'Hiphop', Schlager: 'Schlager', Metal: 'Metal',
};

/** Staat het er al in? Kijkt naar naam, aliassen, het nummer en TMDB-id. */
async function alAanwezig(categorie, items) {
    const namen = [...new Set(items.map((i) => i.naam.toLowerCase()))];
    if (!namen.length) return new Map();
    const tmdbIds = items.filter((i) => i.bron === 'tmdb').map((i) => Number(i.extern_id)).filter(Boolean);
    const muziek = MUZIEK.has(categorie);
    const { rows } = await pool.query(`
        SELECT t.id, lower(t.naam) AS n, lower(COALESCE(t.nummer_naam, '')) AS nn, lower(COALESCE(t.nummer_artiest, '')) AS na,
               t.tmdb_id, t.naam, COALESCE(t.categorie, t.type::text) AS categorie, t.curatie_status, t.uitsluit_reden,
               ${bank.HEEFT_SPEELBAAR} AS speelbaar,
               ARRAY(SELECT lower(a) FROM unnest(COALESCE(t.aliassen, '{}')) a) AS al
          FROM titels t
         WHERE lower(t.naam) = ANY($1) OR t.tmdb_id = ANY($2::int[])
            OR EXISTS (SELECT 1 FROM unnest(COALESCE(t.aliassen, '{}')) a WHERE lower(a) = ANY($1))
            OR ($3 AND lower(t.nummer_naam) = ANY($1))`, [namen, tmdbIds, muziek]);
    const uit = new Map();
    for (const i of items) {
        const n = i.naam.toLowerCase();
        const a = bank.norm(i.artiest);
        const hit = rows.find((r) => i.bron === 'tmdb' && r.tmdb_id && r.tmdb_id === Number(i.extern_id))
            || rows.find((r) => (r.n === n || r.al.includes(n)) && (r.categorie === categorie || (MUZIEK.has(r.categorie) && muziek)))
            || (muziek && rows.find((r) => r.nn === n && (!a || !r.na || bank.norm(r.na) === a)));
        if (hit) {
            const als = hit.naam.toLowerCase() !== n ? ` (als ${hit.naam})` : '';
            uit.set(i, {
                id: hit.id,
                status: hit.curatie_status === 'uitgesloten' ? 'uitgesloten' : hit.speelbaar ? 'speelbaar' : 'bezig',
                tekst: hit.curatie_status === 'uitgesloten' ? `Staat erin${als} maar is uitgesloten`
                    : hit.speelbaar ? `Staat er al in${als}`
                        : `Staat er al in${als}, wordt nog klaargemaakt`,
            });
        }
    }
    return uit;
}

async function zoekBij(categorie, q) {
    if (MUZIEK.has(categorie)) {
        const [it, dc] = await Promise.all([
            itunes.zoek(q, { limiet: 12, cache: false }).catch(() => []),
            discogs.beschikbaar() ? discogs.zoek(q, { limiet: 8 }).catch(() => []) : [],
        ]);
        const lijst = [...it.map((r) => ({
            extern_id: r.itunes_track_id ? String(r.itunes_track_id) : null,
            naam: r.tracknaam, artiest: r.artiest, jaar: r.jaar, poster: r.hoes,
            genres: bank.schoonGenres([GENRE_ITUNES[r.genre] || r.genre], 'muziek'), bron: 'itunes',
        })), ...dc];
        // Dubbelen (zelfde nummer + artiest) weghalen.
        const gezien = new Set();
        return lijst.filter((r) => {
            const k = `${bank.norm(r.naam)}|${bank.norm(r.artiest)}`;
            if (gezien.has(k)) return false;
            gezien.add(k);
            return true;
        }).slice(0, 15);
    }
    if (categorie === 'game') {
        if (igdb.beschikbaar()) return igdb.zoek(q, { limiet: 12 });
        return wikipedia(q, 'video game');
    }
    const type = categorie === 'film' ? 'film' : 'serie';
    if (tmdb.beschikbaar()) {
        const lijst = await tmdb.zoekTitels(q, type);
        return lijst.map((r) => ({
            extern_id: String(r.tmdb_id), naam: r.naam, jaar: r.jaar, poster: r.poster,
            omschrijving: (r.omschrijving || '').slice(0, 160), bron: 'tmdb',
            genres: bank.schoonGenres((r.genre_ids || []).flatMap((g) => TMDB_GENRE[g] || []), categorie),
        }));
    }
    return wikipedia(q, categorie === 'film' ? 'film' : categorie === 'anime' ? 'anime' : 'TV series');
}

router.get('/api/aanvragen/zoek', async (req, res) => {
    try {
        if (!(await wie(req))) return res.status(401).json({ fout: 'Log in of registreer om iets toe te voegen.' });
        const categorie = bank.CATEGORIEEN.includes(req.query.categorie) ? req.query.categorie : 'film';
        const q = String(req.query.q || '').trim();
        if (q.length < 2 || q.length > 120) return res.json({ items: [] });
        const items = (await zoekBij(categorie, q)).filter((i) => i.naam);
        const al = await alAanwezig(categorie, items);
        res.json({ items: items.map((i) => ({ ...i, al_aanwezig: al.has(i), aanwezig: al.get(i) || null })) });
    } catch (err) {
        logger.waarschuwing('Aanvraag zoeken mislukt', { melding: err.message });
        res.status(502).json({ fout: 'Zoeken lukt nu even niet. Typ de naam zelf in en vraag hem zo aan.' });
    }
});

router.post('/api/aanvragen', async (req, res) => {
    try {
        const persoon = await wie(req);
        if (!persoon) return res.status(401).json({ fout: 'Log in of registreer om iets toe te voegen.' });
        if (persoon.id && teVeel(`g${persoon.id}`)) return res.status(429).json({ fout: 'Even rustig aan: maximaal 30 per uur.' });
        const b = req.body || {};
        const categorie = bank.CATEGORIEEN.includes(b.categorie) ? b.categorie : null;
        const naam = String(b.naam || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!categorie || naam.length < 2) return res.status(400).json({ fout: 'Kies een categorie en vul een naam in.' });
        const jaar = Number.isInteger(Number(b.jaar)) && Number(b.jaar) >= 1900 && Number(b.jaar) <= new Date().getFullYear() + 1 ? Number(b.jaar) : null;
        const artiest = MUZIEK.has(categorie) ? String(b.artiest || '').trim().slice(0, 200) || null : null;
        const door = String(persoon.naam || 'een speler').slice(0, 60);
        const genres = bank.schoonGenres(b.genres, categorie);

        const item = { naam, artiest, bron: b.bron, extern_id: b.extern_id };
        const bestaat = (await alAanwezig(categorie, [item])).get(item);
        if (bestaat) {
            await pool.query(
                `INSERT INTO aanvragen (titel_id, categorie, naam, jaar, artiest, bron, extern_id, aangevraagd_door, gebruiker_id, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'bestaat')`,
                [bestaat.id, categorie, naam, jaar, artiest, b.bron || null, b.extern_id || null, door, persoon.id]);
            return res.json({ status: 'bestaat', melding: `${bestaat.tekst}.` });
        }

        const tmdbId = b.bron === 'tmdb' && /^\d+$/.test(String(b.extern_id || '')) ? Number(b.extern_id) : null;
        const poster = typeof b.poster === 'string' ? b.poster : null;
        const posterPad = poster && /image\.tmdb\.org\/t\/p\/\w+(\/.+)$/.test(poster) ? poster.match(/image\.tmdb\.org\/t\/p\/\w+(\/.+)$/)[1] : null;
        const { rows: [t] } = await pool.query(
            `INSERT INTO titels (naam, type, taal, jaar, categorie, tmdb_id, poster_pad, cover_url, nummer_naam, nummer_artiest,
                    ai_status, curatie_status, toevoeg_reden, handmatig, genres, muziek_genres, ai_genres)
             VALUES ($1, $2::titel_type, 'en', $3, $4, $5, $6, $7, $8, $9, 'nieuw', 'goedgekeurd', $10, ARRAY['categorie'], $11, $11, $12)
             RETURNING id`,
            [naam, bank.typeVoorCategorie(categorie, categorie === 'film' ? 'film' : 'serie'), jaar, categorie, tmdbId,
                posterPad, MUZIEK.has(categorie) ? poster : null, MUZIEK.has(categorie) ? naam : null, artiest,
                `Aanvraag van ${door}`, categorie === 'game' ? ['Videogames'] : [], genres]);
        await pool.query(
            `INSERT INTO aanvragen (titel_id, categorie, naam, jaar, artiest, bron, extern_id, aangevraagd_door, gebruiker_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [t.id, categorie, naam, jaar, artiest, b.bron || 'handmatig', b.extern_id || null, door, persoon.id]);
        await bank.log(t.id, 'aanvulling', `Aanvraag van ${door}: ${naam} (${bank.CATEGORIE_LABEL[categorie]})`);
        worker.porren();
        res.json({ status: 'toegevoegd', melding: 'Toegevoegd! De AI controleert hem en zoekt de muziek.' });
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
