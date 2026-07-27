// =====================================================================
// TMDB-import: vult de titeldatabase automatisch met honderden tot
// duizenden films en series.
//
// Waarom: een handgeschreven lijst van ~300 titels is veel te weinig.
// TMDB kent tienduizenden titels met naam, jaar, genres, taal en land —
// precies wat VenTune nodig heeft. De gratis API-key staat al in .env
// (TMDB_API_KEY).
//
// Gebruik (in de servercontainer):
//   node /app/seed/tmdb-import.js                 # standaard ruime set
//   node /app/seed/tmdb-import.js --paginas 30    # meer per categorie
//   node /app/seed/tmdb-import.js --min-stemmen 50
//
// Dit script voegt alléén titels toe (geen muziek). Draai daarna
// import.js om er intro's/thema's bij te zoeken.
// =====================================================================

const { pool } = require('../server/db/pool');

const BASIS = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY || '';

const args = process.argv.slice(2);
function arg(naam, standaard) {
    const i = args.indexOf(`--${naam}`);
    return i >= 0 ? Number(args[i + 1]) : standaard;
}

const PAGINAS = arg('paginas', 20); // 20 pagina's = ~400 titels per categorie
const MIN_STEMMEN = arg('min-stemmen', 25); // filtert obscure titels weg

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Weiger titels met niet-Latijns schrift.
const NIET_LATIJN =
    /[Ѐ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿⺀-鿿가-힯ﭐ-﷿ﹰ-﻿]/;

// TMDB-genre-id's → Nederlandse namen (film en tv samen).
const GENRES = {
    28: 'Actie', 12: 'Avontuur', 16: 'Animatie', 35: 'Komedie', 80: 'Misdaad',
    99: 'Documentaire', 18: 'Drama', 10751: 'Familie', 14: 'Fantasy',
    36: 'Historisch', 27: 'Horror', 10402: 'Musical', 9648: 'Mysterie',
    10749: 'Romantiek', 878: 'Sciencefiction', 10770: 'Televisiefilm',
    53: 'Thriller', 10752: 'Oorlog', 37: 'Western',
    10759: 'Actie', 10762: 'Familie', 10763: 'Nieuws', 10764: 'Realityshow',
    10765: 'Sciencefiction', 10766: 'Drama', 10767: 'Talkshow', 10768: 'Oorlog',
};

// Landcode → Nederlandse landnaam (de meest voorkomende).
const LANDEN = {
    NL: 'Nederland', BE: 'België', US: 'VS', GB: 'VK', DE: 'Duitsland',
    FR: 'Frankrijk', ES: 'Spanje', IT: 'Italië', SE: 'Zweden', NO: 'Noorwegen',
    DK: 'Denemarken', FI: 'Finland', JP: 'Japan', KR: 'Zuid-Korea',
    CN: 'China', IN: 'India', BR: 'Brazilië', MX: 'Mexico', CA: 'Canada',
    AU: 'Australië', NZ: 'Nieuw-Zeeland', IE: 'Ierland', PL: 'Polen',
    RU: 'Rusland', TR: 'Turkije', IL: 'Israël', AR: 'Argentinië', ZA: 'Zuid-Afrika',
};

// Voorselectie, geen wettelijke kijkwijzer. De admin kan altijd corrigeren;
// de veilige kant is belangrijker dan een te lage automatische classificatie.
function leeftijdsgrensVoorGenres(genres = []) {
    const set = new Set(genres.map((g) => String(g).toLowerCase()));
    if (['horror', 'thriller', 'misdaad', 'oorlog'].some((g) => set.has(g))) return 16;
    if (set.has('familie') || set.has('animatie')) return 6;
    if (set.has('fantasy')) return 9;
    if (['actie', 'avontuur', 'sciencefiction', 'musical', 'komedie'].some((g) => set.has(g))) return 12;
    return 16;
}

// TMDB kent twee soorten sleutels:
//  - API Key (v3): korte reeks, gaat mee als ?api_key=...
//  - API Read Access Token (v4): lange reeks die met 'eyJ' begint en als
//    Authorization: Bearer meegestuurd moet worden.
// We ondersteunen ze allebei, zodat het niet uitmaakt welke je kopieert.
const IS_BEARER = KEY.startsWith('eyJ');

async function haal(pad, params = {}) {
    const zoek = new URLSearchParams({ language: 'nl-NL', ...params });
    const opties = { headers: {} };
    if (IS_BEARER) {
        opties.headers.Authorization = `Bearer ${KEY}`;
    } else {
        zoek.set('api_key', KEY);
    }

    const resp = await fetch(`${BASIS}${pad}?${zoek.toString()}`, opties);
    if (resp.status === 429) {
        await slaap(2000);
        return haal(pad, params);
    }
    if (resp.status === 401) {
        const fout = new Error('TMDB weigert de sleutel (401).');
        fout.code = 'ONGELDIGE_SLEUTEL';
        throw fout;
    }
    if (!resp.ok) throw new Error(`TMDB status ${resp.status} op ${pad}`);
    return resp.json();
}

/** Controleer de sleutel voordat we honderden verzoeken doen. */
async function controleerSleutel() {
    try {
        await haal('/configuration');
        return true;
    } catch (err) {
        if (err.code === 'ONGELDIGE_SLEUTEL') return false;
        throw err;
    }
}

/** Zet een TMDB-resultaat om naar een VenTune-titel. */
function naarTitel(r, type) {
    const naam = type === 'serie' ? r.name : r.title;
    const origineel = type === 'serie' ? r.original_name : r.original_title;
    if (!naam) return null;
    if (NIET_LATIJN.test(naam)) return null;

    const datum = type === 'serie' ? r.first_air_date : r.release_date;
    const jaar = datum ? Number(String(datum).slice(0, 4)) : null;
    if (!jaar || jaar < 1950) return null; // buiten het spelbereik

    const taalcode = r.original_language;
    // 'nl' = Nederlandstalig, al het overige valt onder 'internationaal'.
    const taal = taalcode === 'nl' ? 'nl' : 'en';

    const genres = (r.genre_ids || [])
        .map((id) => GENRES[id])
        .filter(Boolean);

    // Aliassen: de originele titel als die afwijkt.
    const aliassen = [];
    if (origineel && origineel !== naam && !NIET_LATIJN.test(origineel)) {
        aliassen.push(origineel);
    }

    const landcode = (r.origin_country && r.origin_country[0]) || null;
    const land = landcode ? LANDEN[landcode] || landcode : null;

    return {
        naam,
        aliassen,
        type,
        taal,
        jaar,
        land,
        genres,
        tmdb_id: r.id,
        stemmen: r.vote_count || 0,
        populariteit: r.popularity || 0,
        poster_pad: r.poster_path || null,
        omschrijving: r.overview || null,
        nl_tv_bekend: false,
        curatie_status: 'te_beoordelen',
        leeftijdsgrens: leeftijdsgrensVoorGenres(genres),
        toevoeg_reden: 'Automatisch toegevoegd via TMDB-populariteitsimport; Nederlandse tv-bekendheid moet nog door de admin worden gecontroleerd.',
    };
}

async function bewaarTitel(t) {
    // Bestaat deze titel al (op tmdb_id, of naam+jaar)?
    const bestaand = await pool.query(
        `SELECT id FROM titels
          WHERE (tmdb_id IS NOT NULL AND tmdb_id = $1)
             OR (naam = $2 AND COALESCE(jaar,0) = COALESCE($3,0))
          LIMIT 1`,
        [t.tmdb_id, t.naam, t.jaar],
    );
    if (bestaand.rows[0]) {
        // Vul ontbrekende gegevens aan (bv. tmdb_id voor bonusvragen).
        await pool.query(
            `UPDATE titels
                SET tmdb_id      = COALESCE(tmdb_id, $2),
                    land         = COALESCE(land, $3),
                    genres       = CASE WHEN cardinality(genres) = 0 THEN $4::text[]
                                        ELSE genres END,
                    populariteit = GREATEST(populariteit, $5),
                    stemmen      = GREATEST(stemmen, $6),
                    poster_pad   = COALESCE(poster_pad, $7),
                    omschrijving = COALESCE(omschrijving, $8)
              WHERE id = $1`,
            [
                bestaand.rows[0].id, t.tmdb_id, t.land, t.genres,
                t.populariteit, t.stemmen, t.poster_pad, t.omschrijving,
            ],
        );
        return false; // niet nieuw
    }
    await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, land, genres,
                             tmdb_id, populariteit, stemmen, poster_pad,
                             omschrijving, nl_tv_bekend, curatie_status,
                             leeftijdsgrens, toevoeg_reden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16)`,
        [
            t.naam, t.aliassen, t.type, t.taal, t.jaar, t.land, t.genres,
            t.tmdb_id, t.populariteit, t.stemmen, t.poster_pad, t.omschrijving,
            t.nl_tv_bekend, t.curatie_status, t.leeftijdsgrens, t.toevoeg_reden,
        ],
    );
    return true;
}

/** Haal meerdere pagina's op van een discover-endpoint. */
async function verzamel(soort, type, extraParams, paginas, label, teller, minStemmen = MIN_STEMMEN) {
    for (let p = 1; p <= paginas; p++) {
        let data;
        try {
            data = await haal(`/discover/${soort}`, {
                page: String(p),
                sort_by: 'popularity.desc',
                include_adult: 'false',
                'vote_count.gte': String(minStemmen),
                ...extraParams,
            });
        } catch (err) {
            if (err.code === 'ONGELDIGE_SLEUTEL') throw err; // meteen stoppen
            console.log(`  ${label} pagina ${p}: ${err.message}`);
            break;
        }
        const resultaten = data.results || [];
        if (resultaten.length === 0) break;

        for (const r of resultaten) {
            const t = naarTitel(r, type);
            if (!t) continue;
            try {
                if (await bewaarTitel(t)) teller.nieuw++;
                else teller.bestond++;
            } catch (err) {
                teller.fouten++;
            }
        }
        if (p >= (data.total_pages || 1)) break;
        await slaap(120); // vriendelijk voor de API
    }
    console.log(`  ${label}: klaar (nieuw tot nu toe: ${teller.nieuw})`);
}

async function maakCatalogusCollectie(sleutel, naam, beschrijving, type, reden) {
    const { rows } = await pool.query(
        `INSERT INTO collecties (sleutel, naam, beschrijving, standaard_type, toevoeg_reden)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sleutel) DO UPDATE SET
             naam = EXCLUDED.naam,
             beschrijving = EXCLUDED.beschrijving,
             standaard_type = EXCLUDED.standaard_type
         RETURNING id`,
        [sleutel, naam, beschrijving, type, reden],
    );
    return rows[0].id;
}

async function koppelCatalogusCollecties(titelId, sleutels) {
    for (const sleutel of [...new Set(sleutels)]) {
        const { rows } = await pool.query(
            `SELECT id FROM collecties WHERE sleutel = $1 LIMIT 1`,
            [sleutel],
        );
        if (!rows[0]) continue;
        await pool.query(
            `INSERT INTO titel_collecties (titel_id, collectie_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [titelId, rows[0].id],
        );
    }
}

async function idVanTitel(titel) {
    const { rows } = await pool.query(
        `SELECT id FROM titels
          WHERE (tmdb_id IS NOT NULL AND tmdb_id = $1)
             OR (naam = $2 AND COALESCE(jaar, 0) = COALESCE($3, 0))
          ORDER BY CASE WHEN tmdb_id = $1 THEN 0 ELSE 1 END
          LIMIT 1`,
        [titel.tmdb_id, titel.naam, titel.jaar],
    );
    return rows[0]?.id || null;
}

/**
 * Haal één jaartop op. TMDB kan door een stemdrempel minder dan 100
 * resultaten teruggeven; oudere jaren vallen daarom gecontroleerd terug
 * van 100 naar 25 naar 1 stem, met deduplicatie op TMDB-id.
 */
async function haalTopVoorJaar(soort, type, jaar, limiet, nederlandstalig = false) {
    const gevonden = [];
    const gezien = new Set();
    const huidigJaar = new Date().getUTCFullYear();
    const vandaag = new Date().toISOString().slice(0, 10);
    const laatsteDatum = jaar === huidigJaar ? vandaag : `${jaar}-12-31`;
    const datum = type === 'serie'
        ? { 'first_air_date.gte': `${jaar}-01-01`, 'first_air_date.lte': laatsteDatum }
        : { 'primary_release_date.gte': `${jaar}-01-01`, 'primary_release_date.lte': laatsteDatum };
    const taal = nederlandstalig ? { with_original_language: 'nl' } : {};

    for (const stemdrempel of [100, 25, 1]) {
        for (let pagina = 1; pagina <= 5 && gevonden.length < limiet; pagina++) {
            const data = await haal(`/discover/${soort}`, {
                ...datum,
                ...taal,
                page: String(pagina),
                sort_by: 'vote_average.desc',
                include_adult: 'false',
                'vote_count.gte': String(stemdrempel),
            });
            for (const resultaat of data.results || []) {
                if (gezien.has(resultaat.id)) continue;
                const titel = naarTitel(resultaat, type);
                if (!titel) continue;
                gezien.add(resultaat.id);
                gevonden.push(titel);
                if (gevonden.length >= limiet) break;
            }
            if (!data.results?.length || pagina >= (data.total_pages || 1)) break;
            await slaap(120);
        }
    }
    return gevonden.slice(0, limiet);
}

function berekenCatalogusOmvang({ startJaar = 1980, eindJaar = new Date().getUTCFullYear() } = {}) {
    const jaren = Math.max(0, eindJaar - startJaar + 1);
    const nederlandstaligeJaren = Math.max(0, eindJaar - 1950 + 1);
    return {
        jaren,
        nederlandstaligeJaren,
        films: jaren * 100,
        series: jaren * 100,
        nederlandstaligeFilms: nederlandstaligeJaren * 10,
        nederlandstaligeSeries: nederlandstaligeJaren * 10,
    };
}

/**
 * Bouw de grote, herhaalbare jaartalcatalogus. Dit vult alleen metadata; er
 * worden geen YouTube-requests en geen downloads vanuit deze taak gestart.
 * De bestaande admin-acties "YouTube zoeken" en "MP3 downloaden" blijven
 * daardoor afzonderlijk, hervatbaar en zichtbaar.
 */
async function importeerJaarCatalogus({
    startJaar = 1980,
    eindJaar = new Date().getUTCFullYear(),
    opProgress = null,
} = {}) {
    if (!KEY) throw new Error('TMDB_API_KEY ontbreekt. Zet deze in .env en start de server opnieuw.');
    if (!(await controleerSleutel())) throw new Error('TMDB weigert deze sleutel (401).');

    const van = Math.max(1950, Number(startJaar) || 1980);
    const tot = Math.min(new Date().getUTCFullYear(), Number(eindJaar) || new Date().getUTCFullYear());
    if (tot < van) throw new Error('Eindjaar moet gelijk aan of groter dan startjaar zijn.');

    const omvang = berekenCatalogusOmvang({ startJaar: Math.max(1980, van), eindJaar: tot });
    const verwacht = omvang.films + omvang.series
        + omvang.nederlandstaligeFilms + omvang.nederlandstaligeSeries;
    let verwerkt = 0;
    let nieuw = 0;
    let bestaand = 0;
    let fouten = 0;

    await maakCatalogusCollectie(
        'top100-per-jaar', 'Top 100 per jaar',
        'Best beoordeelde films en series per jaartal volgens TMDB.', 'beide',
        'Automatische jaartalcatalogus; TMDB-score en populariteit bepalen de volgorde.',
    );
    await maakCatalogusCollectie(
        'top100-films', 'Top 100 films',
        'Films uit de top 100 per jaartal.', 'film',
        'Automatische TMDB-jaartalcatalogus voor films.',
    );
    await maakCatalogusCollectie(
        'top100-series', 'Top 100 series',
        'Series uit de top 100 per jaartal.', 'serie',
        'Automatische TMDB-jaartalcatalogus voor series.',
    );
    await maakCatalogusCollectie(
        'nederlandstalig-top10', 'Nederlandstalige top 10',
        'Nederlandstalige films en series per jaartal vanaf 1950.', 'beide',
        'Automatische selectie van oorspronkelijk Nederlandstalige TMDB-titels.',
    );

    async function verwerk(lijst, jaar, type, collecties, reden) {
        for (const [index, titel] of lijst.entries()) {
            try {
                const wasEr = await idVanTitel(titel);
                titel.toevoeg_reden = `${reden} Rang ${index + 1}; nog te beoordelen op Nederlandse tv-bekendheid.`;
                titel.curatie_status = 'te_beoordelen';
                titel.nl_tv_bekend = false;
                const isNieuw = await bewaarTitel(titel);
                const id = await idVanTitel(titel);
                if (!id) throw new Error('Titel kon niet worden teruggevonden na opslaan.');
                await koppelCatalogusCollecties(id, collecties);
                if (isNieuw && !wasEr) nieuw++;
                else bestaand++;
            } catch (err) {
                fouten++;
                console.error(`Catalogustitel overgeslagen (${titel.naam}): ${err.message}`);
            }
            verwerkt++;
            opProgress?.({
                fase: `${type === 'film' ? 'Films' : 'Series'} ${jaar}`,
                jaar,
                type,
                verwerkt,
                totaal: verwacht,
                nieuw,
                bestaand,
                fouten,
                huidige: titel.naam,
            });
        }
    }

    for (let jaar = Math.max(1980, van); jaar <= tot; jaar++) {
        for (const [soort, type, collectie] of [['movie', 'film', 'top100-films'], ['tv', 'serie', 'top100-series']]) {
            const lijst = await haalTopVoorJaar(soort, type, jaar, 100);
            await verwerk(
                lijst,
                jaar,
                type,
                ['top100-per-jaar', collectie],
                `Top 100 ${type} uit ${jaar} volgens TMDB-score/populariteit.`,
            );
        }
    }

    for (let jaar = 1950; jaar <= tot; jaar++) {
        for (const [soort, type] of [['movie', 'film'], ['tv', 'serie']]) {
            const lijst = await haalTopVoorJaar(soort, type, jaar, 10, true);
            await verwerk(
                lijst,
                jaar,
                type,
                ['nederlandstalig-top10'],
                `Nederlandstalige top 10 ${type} uit ${jaar} volgens TMDB-score/populariteit.`,
            );
        }
    }

    return {
        startJaar: van,
        eindJaar: tot,
        verwacht,
        verwerkt,
        nieuw,
        bestaand,
        fouten,
        omvang,
        vervolg: 'Start daarna YouTube zoeken voor titels zonder track en MP3-downloads in aparte admin-taken.',
    };
}

async function importeerTmdb({ paginas = PAGINAS, minStemmen = MIN_STEMMEN, type = 'beide', genre = '' } = {}) {
    const soort = ['film', 'serie'].includes(type) ? type : 'beide';
    if (!KEY) {
        throw new Error('TMDB_API_KEY ontbreekt. Zet deze in .env en start de server opnieuw.');
    }

    console.log(
        `Sleutel gevonden (${IS_BEARER ? 'Read Access Token' : 'API Key v3'}), controleren…`,
    );
    if (!(await controleerSleutel())) {
        throw new Error('TMDB weigert deze sleutel (401). Controleer TMDB_API_KEY in .env.');
    }
    console.log('Sleutel werkt.\n');

    const teller = { nieuw: 0, bestond: 0, fouten: 0 };
    const genreTekst = String(genre || '').trim();
    const genreId = /^\d+$/.test(genreTekst)
        ? Number(genreTekst)
        : Object.entries(GENRES).find(([, naam]) => naam.toLowerCase() === genreTekst.toLowerCase())?.[0];
    const genreParams = genreId ? { with_genres: String(genreId) } : {};
    console.log(`TMDB-import gestart (${soort}; ${paginas} pagina's per categorie)…\n`);

    // 1) Nederlandstalig — ruim ophalen, want dat is de dunste categorie.
    console.log('Nederlandstalige films en series:');
    if (soort !== 'serie') {
        await verzamel('movie', 'film', { with_original_language: 'nl', ...genreParams },
            paginas * 2, 'NL films', teller, minStemmen);
        // Ook Belgisch-Nederlandstalig materiaal.
        await verzamel('movie', 'film', { with_origin_country: 'BE', ...genreParams },
            Math.ceil(paginas / 2), 'BE films', teller, minStemmen);
    }
    if (soort !== 'film') {
        await verzamel('tv', 'serie', { with_original_language: 'nl', ...genreParams },
            paginas * 2, 'NL series', teller, minStemmen);
        await verzamel('tv', 'serie', { with_origin_country: 'NL', ...genreParams },
            paginas, 'NL-productie series', teller, minStemmen);
    }

    // 2) Internationaal populair.
    console.log('\nInternationale films en series:');
    if (soort !== 'serie') await verzamel('movie', 'film', { ...genreParams }, paginas, 'populaire films', teller, minStemmen);
    if (soort !== 'film') await verzamel('tv', 'serie', { ...genreParams }, paginas, 'populaire series', teller, minStemmen);

    // 3) Per decennium, zodat oudere klassiekers ook meekomen.
    console.log('\nPer decennium:');
    for (let start = 1950; start < new Date().getFullYear(); start += 10) {
        const eind = start + 9;
        if (soort !== 'serie') {
            await verzamel(
                'movie', 'film',
                {
                    'primary_release_date.gte': `${start}-01-01`,
                    'primary_release_date.lte': `${eind}-12-31`,
                    ...genreParams,
                },
                Math.ceil(paginas / 2),
                `films ${start}-${eind}`,
                teller,
                minStemmen,
            );
        }
        if (soort !== 'film') {
            await verzamel(
                'tv', 'serie',
                {
                    'first_air_date.gte': `${start}-01-01`,
                    'first_air_date.lte': `${eind}-12-31`,
                    ...genreParams,
                },
                Math.ceil(paginas / 4),
                `series ${start}-${eind}`,
                teller,
                minStemmen,
            );
        }
    }

    const totaal = await pool.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE taal='nl')::int AS nl,
                count(*) FILTER (WHERE type='serie')::int AS series
           FROM titels`,
    );
    const d = totaal.rows[0];

    console.log('\n=== Samenvatting ===');
    console.log(`Nieuw toegevoegd: ${teller.nieuw}`);
    console.log(`Bestond al:       ${teller.bestond}`);
    if (teller.fouten) console.log(`Fouten:           ${teller.fouten}`);
    console.log(`\nTotaal in database: ${d.n} titels (${d.nl} Nederlandstalig, ${d.series} series)`);
    console.log('\nVolgende stap — YouTube-muziek erbij zoeken:');
    console.log('  node /app/seed/import.js --db');
    return { ...teller, totaal: d.n, nl: d.nl, series: d.series, genre: genreTekst || null };
}

module.exports = {
    importeerTmdb,
    importeerJaarCatalogus,
    berekenCatalogusOmvang,
    leeftijdsgrensVoorGenres,
};

if (require.main === module) {
    importeerTmdb()
        .then(async () => { await pool.end(); })
        .catch(async (err) => {
            console.error('TMDB-import mislukt:', err.message);
            await pool.end().catch(() => {});
            process.exit(1);
        });
}
