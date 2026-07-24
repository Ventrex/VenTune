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

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIET = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

function slaap(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

async function voegTrackToe(titelId, resultaat) {
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

/**
 * Voer de import uit. Herbruikbaar vanuit de CLI én de admin-portal.
 * @param {object} opties { force, limiet, onLog }
 * @returns {Promise<{verwerkt, metTrack, zonder:string[]}>}
 */
async function importeer({ force = false, limiet = Infinity, onLog } = {}) {
    const bestand = path.join(__dirname, 'titels.json');
    const titels = JSON.parse(fs.readFileSync(bestand, 'utf8'));
    const log = onLog || (() => {});

    let verwerkt = 0;
    let metTrack = 0;
    const zonder = [];

    for (const t of titels) {
        if (verwerkt >= limiet) break;
        verwerkt++;

        const titelId = await upsertTitel(t);

        if (!force && (await heeftTrack(titelId))) {
            metTrack++;
            continue;
        }

        const term = t.zoekterm || `${t.naam} soundtrack`;
        try {
            const resultaten = await itunes.zoek(term, { limiet: 5 });
            if (resultaten.length > 0) {
                await voegTrackToe(titelId, resultaten[0]);
                metTrack++;
                log({ titel: t.naam, gevonden: resultaten[0].tracknaam });
            } else {
                zonder.push(t.naam);
                log({ titel: t.naam, gevonden: null });
            }
        } catch (err) {
            zonder.push(t.naam);
            log({ titel: t.naam, fout: err.message });
        }

        await slaap(150); // Vriendelijk voor de iTunes-API.
    }

    return { verwerkt, metTrack, zonder };
}

module.exports = { importeer };

// Alleen als CLI aangeroepen: draai en sluit de pool.
if (require.main === module) {
    importeer({ force: FORCE, limiet: LIMIET, onLog: (r) => console.log(JSON.stringify(r)) })
        .then(async (s) => {
            console.log('\n=== Samenvatting ===');
            console.log(`Titels verwerkt: ${s.verwerkt}`);
            console.log(`Met track:       ${s.metTrack}`);
            console.log(`Zonder track:    ${s.zonder.length}`);
            if (s.zonder.length) {
                console.log('Geen clip gevonden voor (voeg handmatig toe via /admin):');
                for (const n of s.zonder) console.log(`  - ${n}`);
            }
            await pool.end();
        })
        .catch(async (err) => {
            console.error('Import mislukt:', err.message);
            await pool.end().catch(() => {});
            process.exit(1);
        });
}
