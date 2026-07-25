// =====================================================================
// TMDB-client (alleen server-side, gratis key). Wordt gebruikt voor de
// bonusvragen. Volledig optioneel: zonder TMDB_API_KEY of bij een fout
// wordt er geen bonusvraag gemaakt en speelt het spel gewoon door.
// =====================================================================

const logger = require('./logger');
const { pastBijTitel } = require('./trackcheck');

const BASIS = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY || '';
const TAAL = 'nl-NL';

function beschikbaar() {
    return !!KEY;
}

// TMDB accepteert zowel een API Key (v3, als queryparameter) als een
// Read Access Token (v4, als Bearer-header). Beide worden ondersteund.
const IS_BEARER = KEY.startsWith('eyJ');
const detailsCache = new Map();

async function haal(pad, params = {}) {
    const zoek = new URLSearchParams({ language: TAAL, ...params });
    const opties = { headers: {} };
    if (IS_BEARER) {
        opties.headers.Authorization = `Bearer ${KEY}`;
    } else {
        zoek.set('api_key', KEY);
    }
    const resp = await fetch(`${BASIS}${pad}?${zoek.toString()}`, opties);
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
        tmdbId: data.id,
        naam: data.title || data.name,
        origineleNaam: data.original_title || data.original_name || null,
        jaar,
        genres,
        genreIds,
        regisseur,
        cast,
    };
}

/**
 * Controleer of een lokaal titelrecord nog overeenkomt met TMDB en of de
 * track bij die gecontroleerde titel kan horen. Dit is een tweede controle-
 * laag ná de lokale titel-/aliasmatch. Een bekende afkorting zoals GTST mag
 * dus blijven werken zolang de lokale titel zelf met TMDB overeenkomt.
 *
 * Deze functie is puur gehouden zodat de belangrijkste veiligheidsregels
 * zonder netwerk of TMDB-sleutel getest kunnen worden.
 */
function beoordeelTrackMetDetails(titel, track, details) {
    if (!details?.naam) {
        return { beschikbaar: true, past: false, reden: 'TMDB heeft geen officiële titel teruggegeven.' };
    }

    if (titel?.jaar && details.jaar && Number(titel.jaar) !== Number(details.jaar)) {
        return {
            beschikbaar: true,
            past: false,
            reden: `TMDB-jaar wijkt af (${details.jaar} tegenover ${titel.jaar}).`,
        };
    }

    const tmdbTitel = {
        naam: details.naam,
        aliassen: details.origineleNaam ? [details.origineleNaam] : [],
        jaar: details.jaar,
    };
    const lokaleTitel = pastBijTitel(titel, {
        tracknaam: details.naam,
        album: details.origineleNaam,
    });
    if (!lokaleTitel.past) {
        return {
            beschikbaar: true,
            past: false,
            reden: `TMDB-titel "${details.naam}" past niet bij "${titel.naam}".`,
        };
    }

    const officiëleTrack = pastBijTitel(tmdbTitel, track);
    const lokaleTrack = pastBijTitel(titel, track);
    if (!lokaleTrack.past || (!officiëleTrack.past && lokaleTrack.zekerheid < 0.94)) {
        return {
            beschikbaar: true,
            past: false,
            reden: 'Track voldoet niet aan de lokale én officiële TMDB-titelcontrole.',
        };
    }

    return {
        beschikbaar: true,
        past: true,
        zekerheid: Math.min(1, Math.max(officiëleTrack.zekerheid || 0, lokaleTrack.zekerheid || 0)),
        reden: `TMDB bevestigd: ${details.naam}${details.jaar ? ` (${details.jaar})` : ''}`,
    };
}

async function haalDetailsGecached(tmdbId, type) {
    const sleutel = `${type}:${tmdbId}`;
    if (!detailsCache.has(sleutel)) {
        detailsCache.set(sleutel, haalDetails(tmdbId, type));
    }
    try {
        return await detailsCache.get(sleutel);
    } catch (err) {
        detailsCache.delete(sleutel);
        throw err;
    }
}

/**
 * Controleer één kandidaat. Zonder sleutel of tmdb_id wordt de tweede laag
 * expliciet gemarkeerd als niet beschikbaar; de lokale harde controle blijft
 * dan verplicht en er wordt nooit een onzekere kandidaat toegevoegd.
 */
async function controleerTrackMetTmdb(titel, track) {
    if (!beschikbaar() || !titel?.tmdb_id) {
        return {
            beschikbaar: false,
            past: true,
            reden: 'TMDB-controle niet beschikbaar; lokale titelcontrole gebruikt.',
        };
    }
    try {
        const details = await haalDetailsGecached(titel.tmdb_id, titel.type);
        return beoordeelTrackMetDetails(titel, track, details);
    } catch (err) {
        logger.waarschuwing('TMDB-controle tijdelijk overgeslagen.', {
            tmdb_id: titel.tmdb_id,
            melding: err.message,
        });
        return {
            beschikbaar: false,
            past: true,
            reden: 'TMDB tijdelijk niet bereikbaar; lokale titelcontrole gebruikt.',
        };
    }
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

module.exports = {
    beschikbaar,
    haalDetails,
    haalAfleiderPool,
    beoordeelTrackMetDetails,
    controleerTrackMetTmdb,
};
