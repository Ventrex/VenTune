// =====================================================================
// Bonusvragen op basis van TMDB.
//
// Na de gokfase krijgt de speler een meerkeuzevraag (6 opties) over
// dezelfde titel: regisseur, hoofdrolspeler, jaar of genre. Afleiders
// komen uit dezelfde genre-pool zodat ze plausibel zijn.
//
// De vraag-samenstelling (bouwVraag) is puur en testbaar; genereerBonus
// haalt de data bij TMDB en valt terug op null als dat niet lukt.
// =====================================================================

const tmdb = require('../lib/tmdb');
const logger = require('../lib/logger');

// Statische genre-afleiders voor het geval TMDB-genres beperkt zijn.
const GENRE_AFLEIDERS = [
    'Actie', 'Avontuur', 'Komedie', 'Drama', 'Thriller', 'Horror',
    'Sciencefiction', 'Romantiek', 'Misdaad', 'Fantasy', 'Animatie',
    'Documentaire', 'Oorlog', 'Western', 'Mysterie', 'Kerst', 'Familie',
    'Musical', 'Superhelden', 'Sport',
];

const NU_JAAR = new Date().getFullYear();
const JAAR_AFSTANDEN = [-1, 1, -2, 2, -3, 3, -5, 5, -8, 8, -12, 12];

function jaarAfleiders(jaar, aantal = 5) {
    const doel = Number(jaar);
    if (!Number.isFinite(doel)) return [];
    const kandidaten = [];
    for (const afstand of JAAR_AFSTANDEN) {
        const kandidaat = doel + afstand;
        if (kandidaat >= 1950 && kandidaat <= NU_JAAR
            && kandidaat !== doel && !kandidaten.includes(kandidaat)) {
            kandidaten.push(kandidaat);
        }
    }
    for (let afstand = 13; kandidaten.length < aantal && doel - afstand >= 1950; afstand++) {
        const kandidaat = doel - afstand;
        if (kandidaat !== doel && !kandidaten.includes(kandidaat)) kandidaten.push(kandidaat);
    }
    return hussel(kandidaten).slice(0, aantal).map(String);
}

function hussel(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Kies tot 5 unieke afleiders die niet gelijk zijn aan het juiste antwoord.
function kiesAfleiders(kandidaten, juist, aantal = 5) {
    const uniek = [];
    const gezien = new Set([String(juist).toLowerCase()]);
    for (const k of hussel(kandidaten)) {
        const sleutel = String(k).toLowerCase();
        if (!k || gezien.has(sleutel)) continue;
        gezien.add(sleutel);
        uniek.push(k);
        if (uniek.length >= aantal) break;
    }
    return uniek;
}

/**
 * Bouw één meerkeuzevraag uit de details + afleiderpool.
 * Puur en testbaar. Geeft null als geen enkele vraagsoort lukt.
 *
 * @returns {{vraag, type, opties:{tekst,correct}[]}|null}
 */
function bouwVraag(details, pool = {}, instellingen = {}) {
    const mogelijk = [];

    // Regisseur
    if (details.regisseur && (pool.regisseurs || []).length >= 5) {
        mogelijk.push(() => {
            const afl = kiesAfleiders(pool.regisseurs, details.regisseur);
            if (afl.length < 5) return null;
            return {
                type: 'regisseur',
                vraag: `Wie regisseerde ${details.naam}?`,
                juist: details.regisseur,
                afleiders: afl,
            };
        });
    }

    // Hoofdrolspeler
    if ((details.cast || []).length && (pool.acteurs || []).length >= 5) {
        mogelijk.push(() => {
            const juist = details.cast[0];
            const afl = kiesAfleiders(
                (pool.acteurs || []).filter((a) => !details.cast.includes(a)),
                juist,
            );
            if (afl.length < 5) return null;
            return {
                type: 'acteur',
                vraag: `Wie speelt een hoofdrol in ${details.naam}?`,
                juist,
                afleiders: afl,
            };
        });
    }

    // Jaar
    const jaarBinnenKeuze = Number.isFinite(details.jaar)
        && (!Number.isFinite(Number(instellingen.jaarMin)) || details.jaar >= Number(instellingen.jaarMin))
        && (!Number.isFinite(Number(instellingen.jaarMax)) || details.jaar <= Number(instellingen.jaarMax));
    if (jaarBinnenKeuze) {
        mogelijk.push(() => {
            const afl = jaarAfleiders(details.jaar);
            return {
                type: 'jaar',
                vraag: `In welk jaar kwam ${details.naam} uit?`,
                juist: String(details.jaar),
                afleiders: afl,
            };
        });
    }

    // Genre
    if ((details.genres || []).length) {
        mogelijk.push(() => {
            const juist = details.genres[0];
            const kandidaten = GENRE_AFLEIDERS.filter(
                (g) => !details.genres.includes(g),
            );
            const afl = kiesAfleiders(kandidaten, juist);
            if (afl.length < 5) return null;
            return {
                type: 'genre',
                vraag: `Tot welk genre behoort ${details.naam}?`,
                juist,
                afleiders: afl,
            };
        });
    }

    if (mogelijk.length === 0) return null;

    // Probeer vraagsoorten in willekeurige volgorde tot er één lukt.
    for (const maak of hussel(mogelijk)) {
        const v = maak();
        if (!v) continue;
        const opties = hussel([
            { tekst: v.juist, correct: true },
            ...v.afleiders.map((a) => ({ tekst: a, correct: false })),
        ]);
        return { vraag: v.vraag, type: v.type, opties };
    }
    return null;
}

/**
 * Genereer een bonusvraag voor een titel via TMDB. Geeft null als TMDB
 * niet beschikbaar is, er geen tmdb_id is, of er iets misgaat.
 */
async function genereerBonus(titel, instellingen = {}) {
    if (!tmdb.beschikbaar() || !titel.tmdb_id) return null;
    try {
        const details = await tmdb.haalDetails(titel.tmdb_id, titel.type);
        // De catalogus/titel is de bron van waarheid voor het releasejaar.
        // TMDB kan bij remakes, re-releases of een foutieve match een ander
        // jaar teruggeven; dat mag nooit een bonusvraag buiten de spelperiode
        // introduceren.
        if (Number.isFinite(Number(titel.jaar))) details.jaar = Number(titel.jaar);
        let pool = { regisseurs: [], acteurs: [] };
        if (details.genreIds && details.genreIds.length) {
            pool = await tmdb.haalAfleiderPool(
                details.genreIds[0],
                titel.type,
                titel.tmdb_id,
            );
        }
        return bouwVraag(details, pool, instellingen);
    } catch (err) {
        logger.waarschuwing('Bonusvraag overgeslagen.', { melding: err.message });
        return null;
    }
}

module.exports = { bouwVraag, genereerBonus, GENRE_AFLEIDERS, jaarAfleiders };
