// =====================================================================
// Seed-import voor VenTune.
//
// Leest seed/titels.json, zet de titels in de database en zoekt per titel
// een passende YouTube-intro of titelsong. Alleen als YouTube geen betrouwbare
// match oplevert, valt de import terug op een gratis iTunes-preview. Titels
// die al een track hebben worden overgeslagen (tenzij --force).
//
// Gebruik (bijv. in de servercontainer, waar iTunes bereikbaar is):
//   docker compose exec server node /app/seed/import.js
// of lokaal met een DATABASE_URL:
//   DATABASE_URL=postgres://... node seed/import.js [--force] [--limit N]
//
// De pg-pool, YouTube-helper en iTunes-fallback komen uit de server, zodat er
// geen aparte dependencies nodig zijn.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const itunes = require('../server/lib/itunes');
const ytzoek = require('../server/lib/ytzoek');
const { pastBijTitel } = require('../server/lib/trackcheck');
const tmdb = require('../server/lib/tmdb');

const args = process.argv.slice(2);

function leesSeedCatalogus(collectie = null) {
    const bestanden = [path.join(__dirname, 'titels.json'), path.join(__dirname, 'titels-extra.json')];
    if (collectie) bestanden.push(path.join(__dirname, 'collecties.json'));
    return bestanden.flatMap((bestand) => {
        try {
            return JSON.parse(fs.readFileSync(bestand, 'utf8'));
        } catch (err) {
            if (path.basename(bestand) === 'titels-extra.json' && err.code === 'ENOENT') return [];
            throw err;
        }
    }).filter((t) => !collectie || (t.collecties || []).includes(collectie));
}
const FORCE = args.includes('--force');
const LIMIET = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const KINDERKLASSIEKERS = new Set([
    'Bassie en Adriaan', 'De Fabeltjeskrant', 'Het Huis Anubis', 'SpangaS',
    'Zoop', 'Pippi Langkous', 'Heidi', 'Telekids', 'Sesamstraat', 'Samson en Gert',
]);

function leeftijdVoor(t) {
    if (t.leeftijdsgrens !== undefined && t.leeftijdsgrens !== null) return t.leeftijdsgrens;
    if (KINDERKLASSIEKERS.has(t.naam)) return 10;
    if ((t.genres || []).some((genre) => ['Familie', 'Animatie'].includes(genre))) return 10;
    return 16;
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
 * Kies uit iTunes-fallbackresultaten de meest waarschijnlijke soundtrack/thema
 * voor deze titel, in plaats van botweg het eerste resultaat.
 */
// Weiger niet-Latijns schrift (Arabisch, Cyrillisch, CJK ...).
const NIET_LATIJN =
    /[Ѐ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿⺀-鿿가-힯ﭐ-﷿ﹰ-﻿]/;

function kiesBeste(resultaten, titel) {
    let beste = null;
    let besteScore = -Infinity;

    resultaten = resultaten.filter(
        (r) => !NIET_LATIJN.test(`${r.tracknaam || ''} ${r.album || ''} ${r.artiest || ''}`),
    );
    if (resultaten.length === 0) return null;

    resultaten.forEach((r, index) => {
        const controle = pastBijTitel(titel, r);
        // Eerst hard weigeren. Een hoge iTunes-score mag nooit een
        // onbetrouwbare titelmatch maskeren.
        if (!controle.past) return;

        const naam = normaliseer(r.tracknaam);
        const album = normaliseer(r.album);
        const hooi = `${naam} ${album}`;
        let score = controle.zekerheid * 100;

        // Titelnaam in track- of albumnaam is een sterk signaal.
        score += controle.zekerheid >= 1 ? 15 : 5;
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
        // Lichte voorkeur voor iTunes' eigen volgorde bij gelijkspel binnen
        // deze fallbackbron.
        score -= index * 0.1;

        if (score > besteScore) {
            besteScore = score;
            beste = { ...r, verificatie: controle };
        }
    });

    // Geen enkele kandidaat die de titelcontrole haalt = geen track.
    // Een willekeurig iTunes-resultaat teruggeven zou precies de fout
    // veroorzaken die deze import probeert te voorkomen.
    return beste;
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
                    genres = $6, tmdb_id = COALESCE($7, tmdb_id),
                    toevoeg_reden = COALESCE($8, toevoeg_reden),
                    nl_tv_bekend = COALESCE($9, nl_tv_bekend),
                    curatie_status = COALESCE($10, curatie_status),
                    leeftijdsgrens = COALESCE($11, leeftijdsgrens)
              WHERE id = $1`,
            [
                id,
                t.aliassen || [],
                t.type,
                t.taal,
                t.land || null,
                t.genres || [],
                t.tmdb_id ?? null,
                t.toevoeg_reden || null,
                typeof t.nl_tv_bekend === 'boolean' ? t.nl_tv_bekend : null,
                t.curatie_status || null,
                t.leeftijdsgrens ?? (
                    (KINDERKLASSIEKERS.has(t.naam) || (t.genres || []).some((genre) => ['Familie', 'Animatie'].includes(genre)))
                        ? 10 : null
                ),
            ],
        );
        await koppelCollecties(id, t.collecties);
        return id;
    }
    const nieuw = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, jaar, land, genres, tmdb_id,
                            toevoeg_reden, nl_tv_bekend, curatie_status, leeftijdsgrens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
            t.naam,
            t.aliassen || [],
            t.type,
            t.taal,
            t.jaar ?? null,
            t.land || null,
            t.genres || [],
            t.tmdb_id ?? null,
            t.toevoeg_reden || 'Gecureerde VenTune-lijst: herkenbare film of serie die in Nederland breed te zien was.',
            t.nl_tv_bekend ?? true,
            t.curatie_status || 'goedgekeurd',
            leeftijdVoor(t),
        ],
    );
    await koppelCollecties(nieuw.rows[0].id, t.collecties);
    return nieuw.rows[0].id;
}

/** Koppel een titel aan één of meer herbruikbare spelcollecties. */
async function koppelCollecties(titelId, sleutels = []) {
    if (!Array.isArray(sleutels) || sleutels.length === 0) return;
    for (const sleutel of sleutels.map((x) => String(x).trim().toLowerCase()).filter(Boolean)) {
        const collectie = await pool.query(
            `INSERT INTO collecties (sleutel, naam, standaard_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (sleutel) DO UPDATE SET naam = collecties.naam
             RETURNING id`,
            [sleutel, sleutel.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), tTypeVoorCollectie(sleutel)],
        );
        await pool.query(
            `INSERT INTO titel_collecties (titel_id, collectie_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [titelId, collectie.rows[0].id],
        );
    }
}

function tTypeVoorCollectie(sleutel) {
    if (['smartlappen', 'rock'].includes(sleutel)) return 'muziek';
    if (['pixar', 'disney'].includes(sleutel)) return 'film';
    return 'beide';
}

async function heeftTrack(titelId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM tracks WHERE titel_id = $1 LIMIT 1`,
        [titelId],
    );
    return rows.length > 0;
}

async function voegItunesTrackToe(titelId, resultaat, executor = pool) {
    const { rows } = await executor.query(
        `INSERT INTO tracks (titel_id, bron, itunes_track_id, preview_url,
                             tracknaam, artiest, album, herkenbaarheid,
                             gecontroleerd, verificatie_score, verificatie_reden,
                             bron_url)
         VALUES ($1, 'itunes', $2, $3, $4, $5, $6, 3, true, $7, $8, $3)
         RETURNING id`,
        [
            titelId,
            resultaat.itunes_track_id,
            resultaat.preview_url,
            resultaat.tracknaam,
            resultaat.artiest,
            resultaat.album || null,
            verificatieScore(resultaat),
            resultaat.verificatie?.reden || 'iTunes-titelcontrole',
        ],
    );
    return rows[0];
}

function verificatieScore(resultaat) {
    return Number(resultaat.verificatie?.zekerheid || 0);
}

async function controleerMetLagen(titel, track, lokaleControle) {
    if (!lokaleControle?.past) return null;
    const tmdbControle = await tmdb.controleerTrackMetTmdb(titel, track);
    if (!tmdbControle.past) return null;
    return {
        ...lokaleControle,
        tmdb: tmdbControle,
        reden: tmdbControle.beschikbaar
            ? `${lokaleControle.reden}; ${tmdbControle.reden}`
            : lokaleControle.reden,
    };
}

async function voegYoutubeTrackToe(titelId, video, executor = pool) {
    const { rows } = await executor.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, start_seconde,
                             tracknaam, artiest, herkenbaarheid, gecontroleerd,
                             verificatie_score, verificatie_reden, bron_url)
         VALUES ($1, 'youtube', $2, $3, $4, $5, 3, true, $6, $7, $8)
         RETURNING id`,
        [
            titelId,
            video.videoId,
            0,
            video.titel || 'Intro',
            video.kanaal || 'YouTube',
            verificatieScore(video),
            video.verificatie?.reden || 'YouTube-titelcontrole',
            `https://www.youtube.com/watch?v=${video.videoId}`,
        ],
    );
    return rows[0];
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
        const nieuw = await voegToe(client);
        if (!nieuw?.id) throw new Error('Nieuwe track kon niet worden opgeslagen.');
        await client.query(
            `DELETE FROM tracks WHERE titel_id = $1 AND id <> $2`,
            [titelId, nieuw.id],
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Voer de import uit. Herbruikbaar vanuit de CLI én de admin-portal.
 * @param {object} opties { force, limiet, onLog, alleenDb, youtubeAlleen }
 * @returns {Promise<{verwerkt, metTrack, zonder:string[]}>}
 */
async function importeer({
    force = false,
    limiet = Infinity,
    onLog,
    alleenDb = false,
    youtubeAlleen = false,
    titelFilter = null,
    collectie = null,
    onProgress,
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
        titels = leesSeedCatalogus(collectie);
    }

    let verwerkt = 0;
    let metTrack = 0;
    const zonder = [];

    for (const t of titels) {
        if (verwerkt >= limiet) break;
        verwerkt++;
        onProgress?.({ verwerkt, totaal: Math.min(titels.length, limiet), huidige: t.naam });

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
            let keuze = await ytzoek.zoekVoorTitel(t, { pauzeMs: 250 });
            // Extra slot op de deur: hoort deze video echt bij deze titel?
            if (keuze) {
                const lokaleControle = pastBijTitel(t, {
                    tracknaam: keuze.titel,
                    artiest: keuze.kanaal,
                });
                const check = await controleerMetLagen(t, {
                    tracknaam: keuze.titel,
                    artiest: keuze.kanaal,
                }, lokaleControle);
                if (!check) {
                    log({ titel: t.naam, bron: 'youtube', geweigerd: keuze.titel });
                    keuze = null;
                } else {
                    keuze.verificatie = check;
                }
            }
            if (keuze) {
                // Nu er echt een treffer is, mogen oude tracks wijken.
                if (force) {
                    await vervangTracks(titelId, (client) =>
                        voegYoutubeTrackToe(titelId, keuze, client),
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

        // 2) Lukt YouTube niet, dan pas iTunes als fallback proberen.
        if (!gelukt && !youtubeAlleen) {
            try {
                const term = t.zoekterm || `${t.naam} soundtrack`;
                const resultaten = await itunes.zoek(term, { limiet: 8 });
                let keuze = resultaten.length ? kiesBeste(resultaten, t) : null;
                if (keuze) {
                    const lokaleControle = pastBijTitel(t, keuze);
                    const check = await controleerMetLagen(t, keuze, lokaleControle);
                    if (!check) {
                        log({ titel: t.naam, bron: 'itunes', geweigerd: keuze.tracknaam });
                        keuze = null;
                    } else {
                        keuze.verificatie = check;
                    }
                }
                if (keuze) {
                    if (force) {
                        await vervangTracks(titelId, (client) =>
                            voegItunesTrackToe(titelId, keuze, client),
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

module.exports = { importeer, kiesBeste, verificatieScore };

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
