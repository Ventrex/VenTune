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
                SET tmdb_id = COALESCE(tmdb_id, $2),
                    land    = COALESCE(land, $3),
                    genres  = CASE WHEN cardinality(genres) = 0 THEN $4::text[]
                                   ELSE genres END
              WHERE id = $1`,
            [bestaand.rows[0].id, t.tmdb_id, t.land, t.genres],
        );
        return false; // niet nieuw
    }
    await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, land, genres, tmdb_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.naam, t.aliassen, t.type, t.taal, t.jaar, t.land, t.genres, t.tmdb_id],
    );
    return true;
}

/** Haal meerdere pagina's op van een discover-endpoint. */
async function verzamel(soort, type, extraParams, paginas, label, teller) {
    for (let p = 1; p <= paginas; p++) {
        let data;
        try {
            data = await haal(`/discover/${soort}`, {
                page: String(p),
                sort_by: 'popularity.desc',
                include_adult: 'false',
                'vote_count.gte': String(MIN_STEMMEN),
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

async function main() {
    if (!KEY) {
        console.error(
            'TMDB_API_KEY ontbreekt.\n\n' +
                'Zo los je het op:\n' +
                '  1. Ga naar https://www.themoviedb.org/settings/api\n' +
                '  2. Kopieer de "API Key (v3 auth)" — of de "API Read Access Token"\n' +
                '  3. Zet die in /opt/VenTune/.env bij TMDB_API_KEY=\n' +
                '  4. docker compose up -d\n',
        );
        process.exit(1);
    }

    console.log(
        `Sleutel gevonden (${IS_BEARER ? 'Read Access Token' : 'API Key v3'}), controleren…`,
    );
    if (!(await controleerSleutel())) {
        console.error(
            '\nTMDB weigert deze sleutel (401).\n\n' +
                'Controleer op https://www.themoviedb.org/settings/api:\n' +
                '  • Gebruik de "API Key (v3 auth)" — een korte reeks letters/cijfers,\n' +
                '    of de "API Read Access Token" — een lange reeks die met eyJ begint.\n' +
                '  • Let op spaties of aanhalingstekens in .env (TMDB_API_KEY=abc123,\n' +
                '    dus zonder quotes).\n' +
                '  • Na wijzigen: docker compose up -d\n',
        );
        process.exit(1);
    }
    console.log('Sleutel werkt.\n');

    const teller = { nieuw: 0, bestond: 0, fouten: 0 };
    console.log(`TMDB-import gestart (${PAGINAS} pagina's per categorie)…\n`);

    // 1) Nederlandstalig — ruim ophalen, want dat is de dunste categorie.
    console.log('Nederlandstalige films en series:');
    await verzamel('movie', 'film', { with_original_language: 'nl' },
        PAGINAS * 2, 'NL films', teller);
    await verzamel('tv', 'serie', { with_original_language: 'nl' },
        PAGINAS * 2, 'NL series', teller);
    // Ook Belgisch-Nederlandstalig materiaal.
    await verzamel('movie', 'film', { with_origin_country: 'BE' },
        Math.ceil(PAGINAS / 2), 'BE films', teller);
    await verzamel('tv', 'serie', { with_origin_country: 'NL' },
        PAGINAS, 'NL-productie series', teller);

    // 2) Internationaal populair.
    console.log('\nInternationale films en series:');
    await verzamel('movie', 'film', {}, PAGINAS, 'populaire films', teller);
    await verzamel('tv', 'serie', {}, PAGINAS, 'populaire series', teller);

    // 3) Per decennium, zodat oudere klassiekers ook meekomen.
    console.log('\nPer decennium:');
    for (let start = 1950; start < new Date().getFullYear(); start += 10) {
        const eind = start + 9;
        await verzamel(
            'movie', 'film',
            {
                'primary_release_date.gte': `${start}-01-01`,
                'primary_release_date.lte': `${eind}-12-31`,
            },
            Math.ceil(PAGINAS / 2),
            `films ${start}-${eind}`,
            teller,
        );
        await verzamel(
            'tv', 'serie',
            {
                'first_air_date.gte': `${start}-01-01`,
                'first_air_date.lte': `${eind}-12-31`,
            },
            Math.ceil(PAGINAS / 4),
            `series ${start}-${eind}`,
            teller,
        );
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
    console.log('\nVolgende stap — muziek erbij zoeken:');
    console.log('  node /app/seed/import.js');

    await pool.end();
}

main().catch(async (err) => {
    console.error('TMDB-import mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
