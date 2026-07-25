// =====================================================================
// Seed-import voor VenTune.
//
// Leest seed/titels.json, zet de titels in de database en zoekt per titel
// een passende 30-seconden clip op iTunes (gratis, geen account). Titels
// die al een track hebben worden overgeslagen (tenzij --force).
//
// Gebruik (bijv. in de servercontainer, waar iTunes bereikbaar is):
//   docker compose exec server node /app/seed/import.js
// of lokaal met een DATABASE_URL:
//   DATABASE_URL=postgres://... node seed/import.js [--force] [--limit N]
//
// De pg-pool en iTunes-helper komen uit de server, zodat er geen aparte
// dependencies nodig zijn.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const itunes = require('../server/lib/itunes');
const ytzoek = require('../server/lib/ytzoek');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIET = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function normaliseer(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

// Woorden die wijzen op een echte soundtrack/thema (hoger scoren).
const GOEDE_WOORDEN = [
    'soundtrack', 'motion picture', 'original score', 'original soundtrack',
    'main title', 'main theme', 'theme from', 'theme', 'ost', 'score',
    'titelsong', 'titelmuziek', 'from the', 'end titles', 'suite',
];

/**
 * Kies uit de iTunes-resultaten de meest waarschijnlijke soundtrack/thema
 * voor deze titel, in plaats van botweg het eerste resultaat.
 */
// Weiger niet-Latijns schrift (Arabisch, Cyrillisch, CJK ...).
const NIET_LATIJN =
    /[Ѐ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿⺀-鿿가-힯ﭐ-﷿ﹰ-﻿]/;

function kiesBeste(resultaten, titel) {
    const titelNorm = normaliseer(titel.naam);
    let beste = null;
    let besteScore = -Infinity;

    resultaten = resultaten.filter(
        (r) => !NIET_LATIJN.test(`${r.tracknaam || ''} ${r.artiest || ''}`),
    );
    if (resultaten.length === 0) return null;

    resultaten.forEach((r, index) => {
        const naam = normaliseer(r.tracknaam);
        const album = normaliseer(r.album);
        const hooi = `${naam} ${album}`;
        let score = 0;

        // Titelnaam in track- of albumnaam is een sterk signaal.
        if (titelNorm && (naam.includes(titelNorm) || album.includes(titelNorm))) {
            score += 5;
        }
        // Soundtrack-/thema-woorden.
        for (const w of GOEDE_WOORDEN) {
            if (hooi.includes(w)) {
                score += 2;
                break;
            }
        }
        // Jaar dichtbij (soundtrack komt meestal rond de release uit).
        if (titel.jaar && r.jaar && Math.abs(titel.jaar - r.jaar) <= 2) {
            score += 1;
        }
        // Lichte voorkeur voor iTunes' eigen volgorde bij gelijkspel.
        score -= index * 0.1;

        if (score > besteScore) {
            besteScore = score;
            beste = r;
        }
    });

    return beste || resultaten[0];
}

async function upsertTitel(t) {
    // Zoek op naam + jaar; anders invoegen.
    const bestaand = await pool.query(
        `SELECT id FROM titels WHERE naam = $1 AND COALESCE(jaar, 0) = COALESCE($2, 0)`,
        [t.naam, t.jaar ?? null],
    );
    if (bestaand.rows[0]) {
        const id = bestaand.rows[0].id;
        await pool.query(
            `UPDATE titels SET aliassen = $2, type = $3, taal = $4, land = $5,
                    genres = $6, tmdb_id = COALESCE($7, tmdb_id)
              WHERE id = $1`,
            [
                id,
                t.aliassen || [],
                t.type,
                t.taal,
                t.land || null,
                t.genres || [],
                t.tmdb_id ?? null,
            ],
        );
        return id;
    }
    const nieuw = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, land, genres, tmdb_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
            t.naam,
            t.aliassen || [],
            t.type,
            t.taal,
            t.jaar ?? null,
            t.land || null,
            t.genres || [],
            t.tmdb_id ?? null,
        ],
    );
    return nieuw.rows[0].id;
}

async function heeftTrack(titelId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM tracks WHERE titel_id = $1 LIMIT 1`,
        [titelId],
    );
    return rows.length > 0;
}

async function voegItunesTrackToe(titelId, resultaat) {
    await pool.query(
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             tracknaam, artiest, herkenbaarheid)
         VALUES ($1, 'itunes', $2, $3, $4, $5, 3)
         ON CONFLICT DO NOTHING`,
        [
            titelId,
            resultaat.itunes_track_id,
            resultaat.preview_url,
            resultaat.tracknaam,
            resultaat.artiest,
        ],
    );
}

async function voegYoutubeTrackToe(titelId, video) {
    await pool.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, start_seconde,
                             tracknaam, artiest, herkenbaarheid)
         VALUES ($1, 'youtube', $2, $3, $4, $5, 3)
         ON CONFLICT DO NOTHING`,
        [titelId, video.videoId, 0, video.titel || 'Intro', video.kanaal || 'YouTube'],
    );
}

/**
 * Vervang de bestaande tracks van een titel door één nieuwe. Alleen
 * aanroepen als de nieuwe track er echt is — zo raak je nooit een
 * werkende track kwijt.
 */
async function vervangTracks(titelId, voegToe) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM tracks WHERE titel_id = $1`, [titelId]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    await voegToe();
}

/**
 * Voer de import uit. Herbruikbaar vanuit de CLI én de admin-portal.
 * @param {object} opties { force, limiet, onLog }
 * @returns {Promise<{verwerkt, metTrack, zonder:string[]}>}
 */
async function importeer({
    force = false,
    limiet = Infinity,
    onLog,
    alleenDb = false,
    titelFilter = null,
} = {}) {
    const log = onLog || (() => {});

    let titels;
    if (titelFilter) {
        // Eén (of enkele) titels gericht opnieuw doen, bijvoorbeeld als de
        // gekozen muziek niet klopte. Vervangt altijd de bestaande track.
        const { rows } = await pool.query(
            `SELECT id, naam, aliassen, type, taal, jaar, land, genres, tmdb_id
               FROM titels WHERE naam ILIKE $1 ORDER BY id`,
            [`%${titelFilter}%`],
        );
        titels = rows.map((r) => ({ ...r, _id: r.id }));
        force = true;
    } else if (alleenDb) {
        // Alle titels uit de database die nog geen muziek hebben. Zo krijgen
        // ook de titels die via TMDB zijn toegevoegd een intro/thema.
        const { rows } = await pool.query(
            `SELECT id, naam, aliassen, type, taal, jaar, land, genres, tmdb_id
               FROM titels t
              WHERE ${force ? 'TRUE' : 'NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id)'}
              ORDER BY id`,
        );
        titels = rows.map((r) => ({ ...r, _id: r.id }));
    } else {
        const bestand = path.join(__dirname, 'titels.json');
        titels = JSON.parse(fs.readFileSync(bestand, 'utf8'));
    }

    let verwerkt = 0;
    let metTrack = 0;
    const zonder = [];

    for (const t of titels) {
        if (verwerkt >= limiet) break;
        verwerkt++;

        // Titels uit de database hebben al een id; die uit titels.json niet.
        const titelId = t._id || (await upsertTitel(t));

        if (!force && (await heeftTrack(titelId))) {
            metTrack++;
            continue;
        }
        // Let op: bij --force verwijderen we NIETS vooraf. Een oude track is
        // altijd beter dan geen track. Pas als er een nieuwe gevonden is,
        // vervangen we de oude (zie hieronder).

        // 1) YouTube is de primaire bron: daar staat vrijwel elke intro en
        //    titelsong, ook de Nederlandse. Dit voorkomt handmatig nalopen.
        let gelukt = false;
        try {
            const keuze = await ytzoek.zoekVoorTitel(t, { pauzeMs: 250 });
            if (keuze) {
                // Nu er echt een treffer is, mogen oude tracks wijken.
                if (force) {
                    await vervangTracks(titelId, () =>
                        voegYoutubeTrackToe(titelId, keuze),
                    );
                } else {
                    await voegYoutubeTrackToe(titelId, keuze);
                }
                metTrack++;
                gelukt = true;
                log({
                    titel: t.naam,
                    bron: 'youtube',
                    gevonden: keuze.titel,
                    views: keuze.views ?? null,
                });
            }
        } catch (err) {
            log({ titel: t.naam, bron: 'youtube', fout: err.message });
        }

        // 2) Lukt YouTube niet, dan alsnog iTunes proberen.
        if (!gelukt) {
            try {
                const term = t.zoekterm || `${t.naam} soundtrack`;
                const resultaten = await itunes.zoek(term, { limiet: 8 });
                const keuze = resultaten.length ? kiesBeste(resultaten, t) : null;
                if (keuze) {
                    if (force) {
                        await vervangTracks(titelId, () =>
                            voegItunesTrackToe(titelId, keuze),
                        );
                    } else {
                        await voegItunesTrackToe(titelId, keuze);
                    }
                    metTrack++;
                    gelukt = true;
                    log({ titel: t.naam, bron: 'itunes', gevonden: keuze.tracknaam });
                }
            } catch (err) {
                log({ titel: t.naam, bron: 'itunes', fout: err.message });
            }
        }

        if (!gelukt) {
            zonder.push(t.naam);
            log({ titel: t.naam, gevonden: null });
        }

        await slaap(400); // Vriendelijk voor YouTube.
    }

    return { verwerkt, metTrack, zonder };
}

module.exports = { importeer };

// Alleen als CLI aangeroepen: draai en sluit de pool.
if (require.main === module) {
    // Standaard: eerst de vaste startseed, daarna alle titels in de database
    // die nog geen muziek hebben (bijvoorbeeld via TMDB toegevoegd).
    const alleenDb = args.includes('--db');
    const titelIndex = args.indexOf('--titel');
    const titelFilter = titelIndex >= 0 ? args[titelIndex + 1] : null;
    importeer({
        force: FORCE,
        limiet: LIMIET,
        alleenDb,
        titelFilter,
        onLog: (r) => console.log(JSON.stringify(r)),
    })
        .then(async (s) => {
            console.log('\n=== Samenvatting ===');
            console.log(`Titels verwerkt: ${s.verwerkt}`);
            console.log(`Met track:       ${s.metTrack}`);
            console.log(`Zonder track:    ${s.zonder.length}`);
            if (s.zonder.length) {
                console.log('Geen clip gevonden voor (voeg handmatig toe via /admin):');
                for (const n of s.zonder.slice(0, 40)) console.log(`  - ${n}`);
                if (s.zonder.length > 40) {
                    console.log(`  … en nog ${s.zonder.length - 40} andere`);
                }
            }
            const rest = await pool.query(
                `SELECT count(*)::int AS n FROM titels t
                  WHERE NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id)`,
            );
            if (rest.rows[0].n > 0) {
                console.log(
                    `\nNog ${rest.rows[0].n} titels zonder muziek. Draai opnieuw met:` +
                        '\n  node /app/seed/import.js --db',
                );
            }
            await pool.end();
        })
        .catch(async (err) => {
            console.error('Import mislukt:', err.message);
            await pool.end().catch(() => {});
            process.exit(1);
        });
}
