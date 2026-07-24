// =====================================================================
// TMDB-client (alleen server-side, gratis key). Wordt gebruikt voor de
// bonusvragen. Volledig optioneel: zonder TMDB_API_KEY of bij een fout
// wordt er geen bonusvraag gemaakt en speelt het spel gewoon door.
// =====================================================================

const logger = require('./logger');

const BASIS = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY || '';
const TAAL = 'nl-NL';

function beschikbaar() {
    return !!KEY;
}

async function haal(pad, params = {}) {
    const zoek = new URLSearchParams({ api_key: KEY, language: TAAL, ...params });
    const resp = await fetch(`${BASIS}${pad}?${zoek.toString()}`);
    if (!resp.ok) throw new Error(`TMDB status ${resp.status}`);
    return resp.json();
}

/**
 * Haal genormaliseerde details voor een titel op.
 * @param {number} tmdbId
 * @param {'film'|'serie'} type
 * @returns {Promise<{naam, jaar, genres:string[], genreIds:number[], regisseur, cast:string[]}>}
 */
async function haalDetails(tmdbId, type) {
    const soort = type === 'serie' ? 'tv' : 'movie';
    const data = await haal(`/${soort}/${tmdbId}`, {
        append_to_response: 'credits',
    });

    const genres = (data.genres || []).map((g) => g.name);
    const genreIds = (data.genres || []).map((g) => g.id);
    const cast = ((data.credits && data.credits.cast) || [])
        .slice(0, 5)
        .map((c) => c.name);

    let regisseur = null;
    if (soort === 'movie') {
        const crew = (data.credits && data.credits.crew) || [];
        const dir = crew.find((c) => c.job === 'Director');
        regisseur = dir ? dir.name : null;
    } else {
        regisseur = (data.created_by && data.created_by[0] && data.created_by[0].name) || null;
    }

    const datum = data.release_date || data.first_air_date || '';
    const jaar = datum ? Number(datum.slice(0, 4)) : null;

    return {
        naam: data.title || data.name,
        jaar,
        genres,
        genreIds,
        regisseur,
        cast,
    };
}

/**
 * Haal een pool van andere titels in hetzelfde genre op, voor plausibele
 * afleiders (regisseurs, acteurs). Beperkt tot een paar detail-aanroepen.
 */
async function haalAfleiderPool(genreId, type, exclusiefTmdbId) {
    const soort = type === 'serie' ? 'tv' : 'movie';
    const lijst = await haal(`/discover/${soort}`, {
        with_genres: String(genreId),
        sort_by: 'popularity.desc',
        page: '1',
    });
    const kandidaten = (lijst.results || [])
        .filter((r) => r.id !== exclusiefTmdbId)
        .slice(0, 4);

    const regisseurs = new Set();
    const acteurs = new Set();
    for (const k of kandidaten) {
        try {
            const det = await haalDetails(k.id, type);
            if (det.regisseur) regisseurs.add(det.regisseur);
            det.cast.forEach((a) => acteurs.add(a));
        } catch {
            /* sla over */
        }
    }
    return { regisseurs: [...regisseurs], acteurs: [...acteurs] };
}

module.exports = { beschikbaar, haalDetails, haalAfleiderPool };
