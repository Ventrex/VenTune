// =====================================================================
// Playlist-import: leest YouTube-playlists met intro's en titelsongs en
// koppelt elke video aan de juiste film of serie.
//
// Waarom dit beter is dan zoeken: een playlist als "Nederlandse tv-series
// intro's" bevat per definitie de échte intro's. Geen soundtrack-albums,
// geen reaction-video's, geen misgrepen.
//
// De playlists staan in seed/playlists.json.
//
// Gebruik (in de servercontainer):
//   node /app/seed/playlist-import.js
//   node /app/seed/playlist-import.js --droog     # alleen tonen, niets opslaan
//   node /app/seed/playlist-import.js --nieuw     # onbekende titels aanmaken
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const ytzoek = require('../server/lib/ytzoek');
const { pastBijTitel } = require('../server/lib/trackcheck');

const args = process.argv.slice(2);
const DROOG = args.includes('--droog');
const NIEUW = args.includes('--nieuw');

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Rommel die vaak in videotitels staat maar niet bij de serienaam hoort.
const RUIS = [
    'intro', 'outro', 'opening', 'openingstune', 'titelsong', 'titelmuziek',
    'tune', 'theme song', 'theme', 'main title', 'title sequence', 'generiek',
    'soundtrack', 'ost', 'hd', 'hq', 'full', 'lyrics', 'nederlandse',
    'nederlands', 'serie', 'tv serie', 'tvserie', 'leader', 'begintune',
    'aflevering', 'seizoen', 'season', 'opener', 'credits', 'original',
    'official', 'video', 'audio', 'remastered', 'compilatie',
];

/** Haal de vermoedelijke titelnaam uit een videotitel. */
function schoonTitel(videoTitel) {
    let t = ytzoek.normaliseer(videoTitel);
    // Alles tussen haakjes en na een liggend streepje/pipe weghalen.
    t = t.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    t = t.split('|')[0];
    // Jaartallen weg.
    t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
    // Ruiswoorden weg.
    for (const w of RUIS) {
        t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ');
    }
    return t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Zoek de titel in de database die het beste bij deze videotitel past.
 * Werkt op woord-overlap zodat "Flodder intro (1986)" bij "Flodder" komt.
 */
function matchTitel(videoTitel, titels) {
    const schoon = schoonTitel(videoTitel);
    if (!schoon) return null;
    const videoWoorden = new Set(schoon.split(' ').filter((w) => w.length > 1));

    let beste = null;
    let besteScore = 0;

    for (const t of titels) {
        const kandidaten = [t.naam, ...(t.aliassen || [])];
        for (const kandidaat of kandidaten) {
            const naam = ytzoek.normaliseer(kandidaat).replace(/[^a-z0-9\s]/g, ' ').trim();
            if (!naam) continue;

            // Exacte match op de volledige naam is het sterkst.
            if (schoon === naam) {
                return { titel: t, score: 100 };
            }
            // Komt de volledige titelnaam voor in de videotitel?
            if (naam.length >= 4 && schoon.includes(naam)) {
                const score = 50 + naam.length;
                if (score > besteScore) {
                    besteScore = score;
                    beste = t;
                }
                continue;
            }
            // Woord-overlap: alle woorden van de titel moeten voorkomen.
            const naamWoorden = naam.split(' ').filter((w) => w.length > 1);
            if (naamWoorden.length === 0) continue;
            const allemaal = naamWoorden.every((w) => videoWoorden.has(w));
            if (allemaal) {
                const score = 20 + naamWoorden.length * 5;
                if (score > besteScore) {
                    besteScore = score;
                    beste = t;
                }
            }
        }
    }
    // Te zwakke match negeren om verkeerde koppelingen te voorkomen.
    if (!beste || besteScore < 25) return null;
    return { titel: beste, score: besteScore };
}

async function haalTitels() {
    const { rows } = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar FROM titels`,
    );
    return rows;
}

async function heeftYoutubeTrack(titelId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM tracks WHERE titel_id = $1 AND bron = 'youtube' LIMIT 1`,
        [titelId],
    );
    return rows.length > 0;
}

async function zetTrack(titelId, video) {
    // Playlist-tracks zijn betrouwbaarder: bestaande tracks wijken.
    await pool.query(`DELETE FROM tracks WHERE titel_id = $1`, [titelId]);
    await pool.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, start_seconde,
                             tracknaam, artiest, herkenbaarheid, gecontroleerd,
                             bron_url)
         VALUES ($1, 'youtube', $2, 0, $3, $4, 5, true, $5)
         ON CONFLICT DO NOTHING`,
        [
            titelId,
            video.videoId,
            video.titel.slice(0, 200),
            video.kanaal || 'YouTube',
            `https://www.youtube.com/watch?v=${video.videoId}`,
        ],
    );
}

async function maakTitel(naam, type, taal) {
    const { rows } = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, genres)
         VALUES ($1, '{}', $2, $3, '{}') RETURNING id`,
        [naam, type, taal],
    );
    return rows[0].id;
}

async function main() {
    const lijst = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'playlists.json'), 'utf8'),
    );
    const titels = await haalTitels();
    console.log(`${titels.length} titels in de database, ${lijst.length} playlists.\n`);

    let gekoppeld = 0;
    let nieuwGemaakt = 0;
    let overgeslagen = 0;
    const nietGematcht = [];

    for (const pl of lijst) {
        console.log(`── ${pl.naam}`);
        let videos;
        try {
            videos = await ytzoek.haalPlaylist(pl.id);
        } catch (err) {
            console.log(`   FOUT: ${err.message}`);
            continue;
        }
        console.log(`   ${videos.length} video's gevonden`);

        for (const v of videos) {
            if (!ytzoek.isLatijnsSchrift(v.titel)) continue;

            const match = matchTitel(v.titel, titels);
            // Dubbele controle: de videotitel moet echt bij de titel horen.
            // Zo komt de muziek van de ene film nooit onder de naam van een
            // andere te staan.
            const geldig =
                match &&
                pastBijTitel(match.titel, {
                    tracknaam: v.titel,
                    artiest: v.kanaal,
                }).past;

            if (match && geldig) {
                if (DROOG) {
                    console.log(`   ✓ "${v.titel}" → ${match.titel.naam}`);
                } else {
                    await zetTrack(match.titel.id, v);
                }
                gekoppeld++;
            } else if (match && !geldig) {
                console.log(`   ✗ geweigerd: "${v.titel}" ≠ ${match.titel.naam}`);
                overgeslagen++;
            } else if (NIEUW) {
                // Onbekende titel: aanmaken op basis van de opgeschoonde naam.
                const naam = schoonTitel(v.titel)
                    .split(' ')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');
                if (naam.length < 2) {
                    overgeslagen++;
                    continue;
                }
                if (DROOG) {
                    console.log(`   + nieuw: ${naam}`);
                } else {
                    const id = await maakTitel(naam, pl.type, pl.taal);
                    await zetTrack(id, v);
                    titels.push({ id, naam, aliassen: [], type: pl.type, taal: pl.taal });
                }
                nieuwGemaakt++;
            } else {
                nietGematcht.push(v.titel);
                overgeslagen++;
            }
        }
        await slaap(600); // vriendelijk voor YouTube
    }

    console.log('\n=== Samenvatting ===');
    console.log(`Gekoppeld aan bestaande titels: ${gekoppeld}`);
    if (NIEUW) console.log(`Nieuwe titels aangemaakt:      ${nieuwGemaakt}`);
    console.log(`Overgeslagen:                  ${overgeslagen}`);
    if (nietGematcht.length && !NIEUW) {
        console.log('\nNiet gekoppeld (draai met --nieuw om deze toe te voegen):');
        for (const n of nietGematcht.slice(0, 30)) console.log(`  - ${n}`);
        if (nietGematcht.length > 30) {
            console.log(`  … en nog ${nietGematcht.length - 30} andere`);
        }
    }

    if (!DROOG) {
        const d = await pool.query(
            `SELECT count(*)::int AS speelbaar FROM titels t
              WHERE EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id)`,
        );
        console.log(`\nSpeelbare titels nu: ${d.rows[0].speelbaar}`);
    }

    await pool.end();
}

module.exports = { schoonTitel, matchTitel };

if (require.main === module) {
    main().catch(async (err) => {
        console.error('Playlist-import mislukt:', err.message);
        await pool.end().catch(() => {});
        process.exit(1);
    });
}
