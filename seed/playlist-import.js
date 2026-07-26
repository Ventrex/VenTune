// =====================================================================
// Playlist-import: leest YouTube-playlists met intro's en titelsongs en
// koppelt elke video uitsluitend aan een overtuigend passende titel.
//
// Onzeker = overslaan. Een nieuwe betrouwbare track wordt naast bestaande
// tracks bewaard, zodat fallbacks en rotatie behouden blijven.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const ytzoek = require('../server/lib/ytzoek');
const { matchTitel } = require('../server/lib/title-match');
const { pastBijTitel } = require('../server/lib/trackcheck');
const tmdb = require('../server/lib/tmdb');

const args = process.argv.slice(2);
const CLI_DROOG = args.includes('--droog');
const CLI_NIEUW = args.includes('--nieuw');
const titelIndex = args.indexOf('--titel');
const CLI_TITEL_FILTER = titelIndex >= 0 ? String(args[titelIndex + 1] || '').trim() : '';

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function haalTitels(titelFilter = '') {
    const params = [];
    let where = '';
    if (titelFilter) {
        params.push(`%${titelFilter}%`);
        where = 'WHERE naam ILIKE $1';
    }
    const { rows } = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar, tmdb_id
           FROM titels ${where}
          ORDER BY id`,
        params,
    );
    return rows;
}

async function maakTitel(naam, type, taal) {
    const { rows } = await pool.query(
        `INSERT INTO titels (naam, aliassen, type, taal, genres, toevoeg_reden,
                             nl_tv_bekend, curatie_status)
         VALUES ($1, '{}', $2, $3, '{}', $4, false, 'te_beoordelen') RETURNING id`,
        [naam, type, taal, 'Automatisch gevonden via een YouTube-playlist; Nederlandse tv-bekendheid moet nog door de admin worden gecontroleerd.'],
    );
    return rows[0].id;
}

/** Voeg een playlisttrack toe via de meegegeven executor/transaction. */
async function zetTrack(titelId, video, playlistNaam, executor = pool, tmdbControle = null) {
    const bronUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    const bestaande = await executor.query(
        `SELECT id FROM tracks
          WHERE titel_id = $1 AND (preview_url = $2 OR bron_url = $3)
          LIMIT 1`,
        [titelId, video.videoId, bronUrl],
    );
    if (bestaande.rows[0]) {
        await executor.query(`UPDATE tracks SET laatst_gecontroleerd_op = now() WHERE id = $1`, [bestaande.rows[0].id]);
        return bestaande.rows[0];
    }
    const { rows } = await executor.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, start_seconde,
                             tracknaam, artiest, herkenbaarheid, gecontroleerd,
                             verificatie_score, verificatie_reden,
                             laatst_gecontroleerd_op, bron_url)
         VALUES ($1, 'youtube', $2, 0, $3, $4, 5, true, 1.0, $5, now(), $6)
         RETURNING id`,
        [
            titelId,
            video.videoId,
            video.titel.slice(0, 200),
            video.kanaal || 'YouTube',
            `playlist-match: ${playlistNaam}${tmdbControle?.beschikbaar ? `; ${tmdbControle.reden}` : ''}`.slice(0, 200),
            bronUrl,
        ],
    );
    return rows[0];
}

/** Voeg een playlisttrack atomair toe; bij een fout blijven oude tracks staan. */
async function vervangTracks(titelId, video, playlistNaam, tmdbControle = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const nieuw = await zetTrack(titelId, video, playlistNaam, client, tmdbControle);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function importeerPlaylists({ droog = false, nieuw = false, titelFilter = '' } = {}) {
    const lijst = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'playlists.json'), 'utf8'),
    );
    const titels = await haalTitels(titelFilter);
    console.log(`${titels.length} titels in de database, ${lijst.length} playlists.`);
    if (titelFilter) console.log(`Alleen titels met: "${titelFilter}"`);

    let gekoppeld = 0;
    let nieuwGemaakt = 0;
    let overgeslagen = 0;
    const nietGematcht = [];

    for (const pl of lijst) {
        console.log(`\n── ${pl.naam}`);
        let videos;
        try {
            videos = await ytzoek.haalPlaylist(pl.id);
        } catch (err) {
            console.log(`   FOUT: ${err.message}`);
            continue;
        }

        let playlistGekoppeld = 0;
        console.log(`   ${videos.length} video's gevonden`);

        for (const v of videos) {
            if (!ytzoek.isLatijnsSchrift(v.titel)) continue;

            const match = matchTitel(v.titel, titels);
            const lokaleControle = match && pastBijTitel(match.titel, {
                    tracknaam: v.titel,
                    artiest: v.kanaal,
                });
            const tmdbControle = match && lokaleControle?.past
                ? await tmdb.controleerTrackMetTmdb(match.titel, {
                    tracknaam: v.titel,
                    artiest: v.kanaal,
                })
                : null;
            const geldig = !!(match && lokaleControle?.past && tmdbControle?.past);

            if (match && geldig) {
                if (droog) {
                    console.log(`   ✓ "${v.titel}" → ${match.titel.naam}`);
                } else {
                    await vervangTracks(match.titel.id, v, pl.naam, tmdbControle);
                }
                gekoppeld++;
                playlistGekoppeld++;
                continue;
            }

            if (nieuw && !titelFilter) {
                const naam = v.titel
                    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
                    .replace(/\b(19|20)\d{2}\b/g, ' ')
                    .replace(/\b(intro|outro|opening|theme|titelsong|soundtrack|official)\b/gi, ' ')
                    .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (naam.length < 2) {
                    overgeslagen++;
                    continue;
                }
                if (droog) {
                    console.log(`   + nieuw: ${naam}`);
                } else {
                    const id = await maakTitel(naam, pl.type, pl.taal);
                    await vervangTracks(id, v, pl.naam);
                    titels.push({ id, naam, aliassen: [], type: pl.type, taal: pl.taal });
                }
                nieuwGemaakt++;
                playlistGekoppeld++;
                continue;
            }

            if (match && !geldig) {
                console.log(`   ✗ geweigerd: "${v.titel}" ≠ ${match.titel.naam}`);
            } else {
                nietGematcht.push(v.titel);
            }
            overgeslagen++;
        }

        if (!droog) {
            await pool.query(
                `INSERT INTO playlist_status (playlist_id, naam, aantal_items, gekoppeld)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (playlist_id) DO UPDATE SET
                    naam = EXCLUDED.naam,
                    aantal_items = EXCLUDED.aantal_items,
                    gekoppeld = EXCLUDED.gekoppeld,
                    laatst_gelezen = now()`,
                [pl.id, pl.naam, videos.length, playlistGekoppeld],
            );
        }
        await slaap(600);
    }

    console.log('\n=== Samenvatting ===');
    console.log(`Gekoppeld aan bestaande titels: ${gekoppeld}`);
    if (nieuw) console.log(`Nieuwe titels aangemaakt:      ${nieuwGemaakt}`);
    console.log(`Overgeslagen:                  ${overgeslagen}`);
    if (nietGematcht.length && !nieuw) {
        console.log('\nNiet gekoppeld (draai met --nieuw om deze te bekijken/toe te voegen):');
        for (const n of nietGematcht.slice(0, 30)) console.log(`  - ${n}`);
        if (nietGematcht.length > 30) {
            console.log(`  … en nog ${nietGematcht.length - 30} andere`);
        }
    }

    if (!droog) {
        const d = await pool.query(
            `SELECT count(*)::int AS speelbaar FROM titels t
              WHERE EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id AND x.werkt)`,
        );
        console.log(`\nSpeelbare titels nu: ${d.rows[0].speelbaar}`);
    }

    return { gekoppeld, nieuwGemaakt, overgeslagen, nietGematcht };
}

module.exports = { zetTrack, vervangTracks, importeerPlaylists };

if (require.main === module) {
    importeerPlaylists({
        droog: CLI_DROOG,
        nieuw: CLI_NIEUW,
        titelFilter: CLI_TITEL_FILTER,
    }).then(async () => {
        await pool.end();
    }).catch(async (err) => {
        console.error('Playlist-import mislukt:', err.message);
        await pool.end().catch(() => {});
        process.exit(1);
    });
}
