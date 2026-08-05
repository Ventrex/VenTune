// =====================================================================
// Import van een afgescheiden film-/seriecollectie.
//
// Deze importer raakt de oude seed/titels.json en de oude ruiscatalogus niet.
// De CSV's worden onder seed/collecties/<slug> bewaard; de database krijgt
// een media_collecties-record en collectie_id op alle nieuwe titel/trackrijen.
//
// Gebruik in de servercontainer:
//   node /app/seed/import-collectie.js --titels-only
//   node /app/seed/import-collectie.js --limit 25
//   node /app/seed/import-collectie.js --force
//
// --titels-only maakt de volledige catalogus direct beschikbaar. Zonder die
// vlag zoekt de importer ook één gecontroleerde YouTube-track per titel.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const ytzoek = require('../server/lib/ytzoek');
const { pastBijTitel } = require('../server/lib/trackcheck');
const { verwijderBestanden } = require('../server/lib/media-files');

const COLLECTIE = {
    slug: 'top1000-films-series',
    naam: 'Top 1000 bekende films en series in Nederland',
    omschrijving: 'Bekende films en tv-programma\'s die in Nederland via bioscoop, videotheek, televisie of streaming bekendheid kregen.',
    bron: 'Trakt, IMDb, NVPI en Nederlandse beschikbaarheidssignalen',
    bronUrl: 'https://app.trakt.tv/users/keffosteffo/lists/top-1000-movies-with-at-least-110k-imdb-votes-and-64-rating',
    seedMap: 'seed/collecties/top1000-films-series',
    mediaMap: 'collecties/top1000-films-series',
};

const DATA_MAP = path.join(__dirname, 'collecties', COLLECTIE.slug);
const FORCE = process.argv.includes('--force');
const TITELS_ONLY = process.argv.includes('--titels-only');
const LIMIET = (() => {
    const i = process.argv.indexOf('--limit');
    if (i < 0) return Infinity;
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
})();
const ICONISCH_VIEWS = Number(process.env.ICONISCH_MIN_VIEWS || 5_000_000);

function slaap(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kleine RFC4180-parser; de ranking-CSV's bevatten komma's in genres en
// daarom is split(',') hier bewust niet voldoende.
function parseCsv(tekst) {
    const rijen = [];
    let rij = [];
    let veld = '';
    let quoted = false;

    for (let i = 0; i < tekst.length; i++) {
        const c = tekst[i];
        if (quoted) {
            if (c === '"' && tekst[i + 1] === '"') {
                veld += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                veld += c;
            }
        } else if (c === '"' && veld.length === 0) {
            quoted = true;
        } else if (c === ',') {
            rij.push(veld);
            veld = '';
        } else if (c === '\n') {
            rij.push(veld.replace(/\r$/, ''));
            if (rij.some((item) => item !== '')) rijen.push(rij);
            rij = [];
            veld = '';
        } else {
            veld += c;
        }
    }
    if (veld || rij.length) {
        rij.push(veld.replace(/\r$/, ''));
        if (rij.some((item) => item !== '')) rijen.push(rij);
    }

    const [kop, ...data] = rijen;
    return data.map((waarden) => Object.fromEntries(
        kop.map((naam, i) => [naam, waarden[i] ?? '']),
    ));
}

function tekst(v) {
    const s = String(v ?? '').trim();
    return s || null;
}

function getal(v) {
    const s = tekst(v);
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function geheel(v) {
    const n = getal(v);
    return n === null ? null : Math.round(n);
}

function lijst(v) {
    return String(v || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function genresVoor(v) {
    const vertaling = new Map([
        ['action', 'Actie'], ['adventure', 'Avontuur'], ['animation', 'Animatie'],
        ['comedy', 'Komedie'], ['crime', 'Misdaad'], ['documentary', 'Documentaire'],
        ['drama', 'Drama'], ['family', 'Familie'], ['fantasy', 'Fantasy'],
        ['history', 'Historisch'], ['horror', 'Horror'], ['music', 'Musical'],
        ['mystery', 'Mysterie'], ['romance', 'Romantiek'], ['science fiction', 'Sciencefiction'],
        ['sci-fi', 'Sciencefiction'], ['thriller', 'Thriller'], ['war', 'Oorlog'],
        ['western', 'Western'], ['superhero', 'Superhelden'], ['sport', 'Sport'],
        ['reality', 'Realityshow'],
    ]);
    return lijst(v).map((genre) => vertaling.get(genre.toLowerCase()) || genre);
}

function taalVoor(rij) {
    const taal = `${rij.language || ''} ${rij.nl_signal || ''}`.toLowerCase();
    return /nederlands|dutch|nl-talig/.test(taal) ? 'nl' : 'en';
}

function talenVoor(rij) {
    return lijst(rij.language);
}

function leeftijdsgrensVoor(rij) {
    const waarde = String(rij.age_category || rij.age_rating_raw || '').trim().toLowerCase();
    if (!waarde) return 16;
    if (/18\+|tv-ma|nc-17/.test(waarde)) return 18;
    if (/16\+|tv-16/.test(waarde)) return 16;
    if (/12\+|tv-14|pg-13/.test(waarde)) return 12;
    if (/10\+/.test(waarde)) return 10;
    if (/6\+|tv-pg|tv-y7|pg\b/.test(waarde)) return 6;
    if (/alle leeftijden|all ages|tv-y|\bg\b/.test(waarde)) return 0;
    return 16;
}

function naarTitel(rij) {
    const type = rij.category === 'film' ? 'film' : 'serie';
    const naam = tekst(rij.title);
    return {
        naam,
        origineleNaam: tekst(rij.original_title) || naam,
        aliassen: [tekst(rij.nl_alias)].filter(Boolean),
        type,
        taal: taalVoor(rij),
        talen: talenVoor(rij),
        jaar: geheel(rij.year),
        eindJaar: geheel(rij.end_year),
        land: tekst(rij.country),
        genres: genresVoor(rij.genres),
        tmdbId: geheel(rij.tmdb_id),
        imdbId: tekst(rij.imdb_id),
        imdbScore: getal(rij.imdb_rating),
        imdbStemmen: geheel(rij.imdb_votes),
        populariteit: getal(rij.popularity_score) || 0,
        rankingNummer: geheel(rij.rank),
        traktId: geheel(rij.trakt_id),
        traktRank: geheel(rij.trakt_rank),
        traktLijstRank: geheel(rij.trakt_list_rank),
        studioOfNetwerk: tekst(rij.studio_or_network),
        leeftijd: tekst(rij.age_category) || tekst(rij.age_rating_raw),
        leeftijdsgrens: leeftijdsgrensVoor(rij),
        leeftijdBron: tekst(rij.age_rating_source),
        bronTrakt: tekst(rij.source_trakt),
        bronImdb: tekst(rij.source_imdb),
        bronNl: tekst(rij.source_nl),
        inclusionReason: tekst(rij.inclusion_reason),
    };
}

async function haalCollectie() {
    const { rows } = await pool.query(
        `INSERT INTO media_collecties
             (slug, naam, omschrijving, bron, bron_url, seed_map, media_map, bijgewerkt_op)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (slug) DO UPDATE SET
             naam = EXCLUDED.naam,
             omschrijving = EXCLUDED.omschrijving,
             bron = EXCLUDED.bron,
             bron_url = EXCLUDED.bron_url,
             seed_map = EXCLUDED.seed_map,
             media_map = EXCLUDED.media_map,
             bijgewerkt_op = now()
         RETURNING id, slug, media_map`,
        [COLLECTIE.slug, COLLECTIE.naam, COLLECTIE.omschrijving, COLLECTIE.bron,
            COLLECTIE.bronUrl, COLLECTIE.seedMap, COLLECTIE.mediaMap],
    );
    return rows[0];
}

// Koppel dezelfde titels ook aan het bestaande spelcollectiesysteem. Daardoor
// verschijnt de collectie in Setup en in het bestaande admin-tabblad, terwijl
// media_collecties de database- en mediapaden geïsoleerd houdt.
async function koppelSpelCollectie(titelId) {
    const { rows } = await pool.query(
        `INSERT INTO collecties (sleutel, naam, beschrijving, standaard_type, toevoeg_reden)
         VALUES ($1, $2, $3, 'beide', $4)
         ON CONFLICT (sleutel) DO UPDATE SET naam = EXCLUDED.naam
         RETURNING id`,
        [COLLECTIE.slug, COLLECTIE.naam, COLLECTIE.omschrijving,
            'Aparte top-1000 collectie; automatisch gevuld vanuit de collectie-import.'],
    );
    await pool.query(
        `INSERT INTO titel_collecties (titel_id, collectie_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [titelId, rows[0].id],
    );
}

async function upsertTitel(collectieId, titel) {
    const waarden = [
        collectieId, titel.naam, titel.aliassen, titel.type, titel.taal, titel.jaar,
        titel.land, titel.genres, titel.tmdbId, titel.populariteit, titel.imdbStemmen,
        titel.origineleNaam, titel.eindJaar, titel.talen, titel.studioOfNetwerk,
        titel.leeftijd, titel.leeftijdBron, titel.imdbId, titel.imdbScore,
        titel.rankingNummer, titel.traktId, titel.traktRank, titel.traktLijstRank,
        titel.bronTrakt, titel.bronImdb, titel.bronNl, titel.inclusionReason,
        titel.leeftijdsgrens,
    ];
    const gevonden = await pool.query(
        `SELECT id FROM titels
          WHERE collectie_id = $1 AND lower(naam) = lower($2)
            AND COALESCE(jaar, -1) = COALESCE($6, -1) AND type = $4::titel_type`,
        waarden,
    );
    if (gevonden.rows[0]) {
        const id = gevonden.rows[0].id;
        await pool.query(
            `UPDATE titels SET
                naam = $2, aliassen = $3, type = $4, taal = $5, jaar = $6,
                land = $7, genres = $8, tmdb_id = $9, populariteit = $10,
                stemmen = $11, originele_naam = $12, eind_jaar = $13, talen = $14,
                studio_of_netwerk = $15, leeftijd = $16, leeftijd_bron = $17,
                imdb_id = $18, imdb_score = $19, imdb_stemmen = $20,
                ranking_nummer = $21, trakt_id = $22, trakt_rank = $23,
                trakt_lijst_rank = $24, bron_trakt = $25, bron_imdb = $26,
                bron_nl = $27, inclusion_reason = $28, leeftijdsgrens = $29
              WHERE id = $1`,
            [id, ...waarden.slice(1)],
        );
        return id;
    }

    const { rows } = await pool.query(
        `INSERT INTO titels
            (collectie_id, naam, aliassen, type, taal, jaar, land, genres, tmdb_id,
             populariteit, stemmen, originele_naam, eind_jaar, talen, studio_of_netwerk,
             leeftijd, leeftijd_bron, imdb_id, imdb_score, imdb_stemmen, ranking_nummer,
             trakt_id, trakt_rank, trakt_lijst_rank, bron_trakt, bron_imdb, bron_nl,
             inclusion_reason, leeftijdsgrens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
         RETURNING id`,
        waarden,
    );
    return rows[0].id;
}

async function heeftTrack(titelId, collectieId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM tracks WHERE titel_id = $1 AND collectie_id = $2 LIMIT 1`,
        [titelId, collectieId],
    );
    return rows.length > 0;
}

async function vervangTracks(titelId, collectieId, video) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const views = Math.max(0, geheel(video.views) || 0);
        const { rows } = await client.query(
            `INSERT INTO tracks
                (titel_id, collectie_id, bron, preview_url, start_seconde,
                 tracknaam, artiest, herkenbaarheid, gecontroleerd,
                 verificatie_score, verificatie_reden, bron_url,
                 youtube_views, youtube_likes, yt_iconisch)
             VALUES ($1, $2, 'youtube', $3, 0, $4, $5, 3, true, $6, $7, $8, $9, $10, $11)
             RETURNING id`,
            [
                titelId, collectieId, video.videoId, video.titel || 'Intro',
                video.kanaal || 'YouTube', video._controle?.zekerheid || 0,
                video._controle?.reden || 'YouTube-titelcontrole',
                `https://www.youtube.com/watch?v=${video.videoId}`,
                views, Math.max(0, geheel(video.likes) || 0), views >= ICONISCH_VIEWS,
            ],
        );

        // Bij een vervanging wordt een eventueel oud lokaal bestand ook
        // verwijderd; de aparte delete-helper doet dit voor collectiebrede
        // verwijderingen. Bestaande tracks zonder bestand zijn onschadelijk.
        const oude = await client.query(
            `SELECT bestand_pad FROM tracks
              WHERE titel_id = $1 AND collectie_id = $2 AND id <> $3`,
            [titelId, collectieId, rows[0].id],
        );
        await verwijderBestanden(oude.rows);
        await client.query(
            `DELETE FROM tracks WHERE titel_id = $1 AND collectie_id = $2 AND id <> $3`,
            [titelId, collectieId, rows[0].id],
        );
        await client.query('COMMIT');
        return { id: rows[0].id, oudeBestanden: oude.rows.map((r) => r.bestand_pad).filter(Boolean) };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function importeerCollectie({ force = false, limiet = Infinity, titelsOnly = false, onLog } = {}) {
    const log = onLog || (() => {});
    const collectie = await haalCollectie();
    const bestanden = ['films.csv', 'series.csv'];
    const rijen = bestanden.flatMap((bestand) => {
        const pad = path.join(DATA_MAP, bestand);
        return parseCsv(fs.readFileSync(pad, 'utf8'));
    });
    let verwerkt = 0;
    let metTrack = 0;
    const zonderTrack = [];

    for (const rij of rijen) {
        if (verwerkt >= limiet) break;
        const titel = naarTitel(rij);
        if (!titel.naam) continue;
        verwerkt++;
        const titelId = await upsertTitel(collectie.id, titel);
        await koppelSpelCollectie(titelId);

        if (titelsOnly || (!force && await heeftTrack(titelId, collectie.id))) {
            if (!titelsOnly && await heeftTrack(titelId, collectie.id)) metTrack++;
            log({ titel: titel.naam, status: titelsOnly ? 'titel' : 'bestaande-track' });
            continue;
        }

        try {
            const keuze = await ytzoek.zoekVoorTitel({
                ...titel,
                // zoekVoorTitel gebruikt alleen de spelvelden; de extra
                // rankingmetadata blijft buiten de zoekmatch.
            }, { pauzeMs: 250 });
            if (!keuze) {
                zonderTrack.push(titel.naam);
                log({ titel: titel.naam, status: 'zonder-track' });
                continue;
            }
            const controle = pastBijTitel(titel, {
                tracknaam: keuze.titel,
                artiest: keuze.kanaal,
            });
            if (!controle.past) {
                zonderTrack.push(titel.naam);
                log({ titel: titel.naam, status: 'match-afgewezen', reden: controle.reden });
                continue;
            }
            keuze._controle = controle;
            const resultaat = await vervangTracks(titelId, collectie.id, keuze);
            metTrack++;
            log({
                titel: titel.naam,
                status: 'youtube',
                gevonden: keuze.titel,
                views: keuze.views ?? 0,
                iconisch: (keuze.views || 0) >= ICONISCH_VIEWS,
                oudeBestanden: resultaat.oudeBestanden,
            });
        } catch (err) {
            zonderTrack.push(titel.naam);
            log({ titel: titel.naam, status: 'fout', fout: err.message });
        }
        await slaap(400);
    }
    return { collectie: collectie.slug, verwerkt, metTrack, zonderTrack };
}

module.exports = {
    COLLECTIE,
    parseCsv,
    naarTitel,
    importeerCollectie,
};

if (require.main === module) {
    importeerCollectie({
        force: FORCE,
        limiet: LIMIET,
        titelsOnly: TITELS_ONLY,
        onLog: (regel) => console.log(JSON.stringify(regel)),
    })
        .then(async (samenvatting) => {
            console.log(JSON.stringify(samenvatting, null, 2));
            await pool.end();
        })
        .catch(async (err) => {
            console.error(`Collectie-import mislukt: ${err.message}`);
            await pool.end().catch(() => {});
            process.exitCode = 1;
        });
}
