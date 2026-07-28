// =====================================================================
// Seed-import voor VenTune.
//
// Leest seed/titels.json, zet de titels in de database en zoekt per titel
// een passende YouTube-intro of titelsong. YouTube wordt uitsluitend als
// downloadbron geregistreerd; het spel gebruikt later alleen lokale audio.
// Titels die al een werkende YouTube-track of gezonde lokale track hebben
// worden overgeslagen. Alleen --titel is een bewuste gerichte reparatie.
//
// Gebruik (bijv. in de servercontainer, waar iTunes bereikbaar is):
//   docker compose exec server node /app/seed/import.js
// of lokaal met een DATABASE_URL:
//   DATABASE_URL=postgres://... node seed/import.js [--db] [--titel Naam] [--limit N]
//
// De pg-pool en YouTube-helper komen uit de server, zodat er geen aparte
// dependencies nodig zijn.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db/pool');
const ytzoek = require('../server/lib/ytzoek');
const soundtrack = require('../server/lib/soundtrack');
const { pastBijTitel } = require('../server/lib/trackcheck');
const tmdb = require('../server/lib/tmdb');
const { veiligeTiteltekst, veiligeMetadata } = require('../server/lib/content-filter');

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
    }).filter((t) => (!collectie || (t.collecties || []).includes(collectie))
        && veiligeTiteltekst(t.naam));
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
function kiesBeste(resultaten, titel) {
    let beste = null;
    let besteScore = -Infinity;

    resultaten = resultaten.filter((r) => veiligeMetadata(
        r.tracknaam || '', r.album || '', r.artiest || '',
    ));
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
                    studio = COALESCE($8, studio),
                    toevoeg_reden = COALESCE($9, toevoeg_reden),
                    nl_tv_bekend = COALESCE($10, nl_tv_bekend),
                    curatie_status = COALESCE($11, curatie_status),
                    leeftijdsgrens = COALESCE($12, leeftijdsgrens)
              WHERE id = $1`,
            [
                id,
                t.aliassen || [],
                t.type,
                t.taal,
                t.land || null,
                t.genres || [],
                t.tmdb_id ?? null,
                t.studio || null,
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
                            studio, toevoeg_reden, nl_tv_bekend, curatie_status, leeftijdsgrens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
            t.naam,
            t.aliassen || [],
            t.type,
            t.taal,
            t.jaar ?? null,
            t.land || null,
            t.genres || [],
            t.tmdb_id ?? null,
            t.studio || null,
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

/**
 * De database is leidend. Een opgeslagen, werkende YouTube-match is al een
 * bekende kandidaat en wordt niet opnieuw opgezocht.
 * Alleen een ontbrekende of afgekeurde track komt opnieuw in de zoekstroom.
 * Een lokale track telt alleen mee als de database zegt dat het bestand
 * beschikbaar is; de dagelijkse media-health controle houdt die status bij.
 */
async function heeftWerkendeTrack(titelId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM tracks
          WHERE titel_id = $1 AND werkt = true
            AND preview_url IS NOT NULL AND preview_url <> ''
            AND ((bron = 'lokaal' AND itunes_track_id IS NULL AND download_status = 'available')
                 OR bron = 'youtube')
          LIMIT 1`,
        [titelId],
    );
    return rows.length > 0;
}

async function meldOntbrekendeTrack(titelId) {
    await pool.query(
        `INSERT INTO meldingen (titel_id, soort, toelichting)
         SELECT $1, 'geen_track',
                'Geen betrouwbare match gevonden; voeg audio of een gecontroleerde YouTube-link toe via het adminportaal.'
          WHERE NOT EXISTS (
              SELECT 1 FROM tracks
               WHERE titel_id = $1 AND werkt = true
                 AND bron <> 'itunes'
                 AND (bron <> 'lokaal' OR itunes_track_id IS NULL)
                 AND preview_url IS NOT NULL AND preview_url <> ''
          )
            AND NOT EXISTS (
              SELECT 1 FROM meldingen
               WHERE titel_id = $1 AND soort = 'geen_track' AND afgehandeld = false
          )`,
        [titelId],
    );
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

async function voegYoutubeTrackToe(titelId, video, executor = pool, songnaam = null) {
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
                             laatst_gecontroleerd_op, bron_url,
                             bevestigd, songnaam)
         VALUES ($1, 'youtube', $2, $3, $4, $5, 3, true, $6, $7, now(), $8,
                 $9, $10)
         RETURNING id`,
        [
            titelId,
            video.videoId,
            0,
            video.titel || 'Intro',
            video.kanaal || 'YouTube',
            verificatieScore(video),
            video.verificatie?.reden || 'YouTube-titelcontrole',
            bronUrl,
            Boolean(songnaam),
            songnaam,
        ],
    );
    return rows[0];
}

/**
 * Voeg een nieuwe betrouwbare track atomair toe. Bestaande tracks blijven
 * bewaard als fallback en voor rotatie; een mislukte insert wijzigt niets.
 */
async function vervangTracks(titelId, voegToe) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const nieuw = await voegToe(client);
        if (!nieuw?.id) throw new Error('Nieuwe track kon niet worden opgeslagen.');
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
 * @param {object} opties { force, limiet, onLog, alleenDb, youtubeAlleen,
 *                           alleenZonderLokaal }
 * @returns {Promise<{verwerkt, metTrack, zonder:string[]}>}
 */
async function importeer({
    force = false,
    limiet = Infinity,
    onLog,
    alleenDb = false,
    youtubeAlleen = false,
    alleenZonderLokaal = false,
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
        // Alleen de database is hier de bron. Een bestaande YouTube-match is
        // al een opgeslagen kandidaat en hoort dus niet opnieuw gezocht te
        // worden. Bij alleenZonderLokaal wordt die bestaande kandidaat later
        // door de aparte downloadtaak lokaal gemaakt.
        const databaseLimiet = Number.isFinite(Number(limiet))
            ? Math.max(1, Math.floor(Number(limiet)))
            : null;
        const parameters = databaseLimiet ? [databaseLimiet] : [];
        const limietSql = databaseLimiet ? `\n              LIMIT $1` : '';
        const { rows } = await pool.query(
            `SELECT id, naam, aliassen, type, taal, jaar, land, genres, tmdb_id
               FROM titels t
              WHERE ${alleenZonderLokaal
                ? `NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
                                 AND x.bron = 'lokaal' AND x.itunes_track_id IS NULL AND x.werkt = true
                                 AND x.download_status = 'available')
                    AND NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
                                    AND x.bron = 'youtube' AND x.werkt = true
                                    AND x.preview_url IS NOT NULL AND x.preview_url <> '')`
                : `NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
                               AND x.werkt = true AND x.preview_url IS NOT NULL
                               AND x.preview_url <> ''
                               AND (x.bron = 'youtube' OR
                                    (x.bron = 'lokaal' AND x.itunes_track_id IS NULL
                                     AND x.download_status = 'available')))`}
              ORDER BY id${limietSql}`,
            parameters,
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
        if (!veiligeTiteltekst(t.naam)) {
            log({ titel: t.naam, gevonden: null, overgeslagen: 'onveilige tekens' });
            continue;
        }
        verwerkt++;
        onProgress?.({ verwerkt, totaal: Math.min(titels.length, limiet), huidige: t.naam });

        // Titels uit de database hebben al een id; die uit titels.json niet.
        const titelId = t._id || (await upsertTitel(t));

        // Niet opnieuw naar dezelfde bron zoeken. Een gerichte --titel-
        // opdracht blijft de bewuste uitzondering voor een reparatie.
        if (!titelFilter && (await heeftWerkendeTrack(titelId))) {
            metTrack++;
            continue;
        }
        // Let op: een oude track is altijd beter dan geen track en meerdere
        // betrouwbare tracks geven rotatie. Alleen een gerichte titelactie
        // mag bewust opnieuw zoeken.

        let gelukt = false;

        // 1) Eerst uitzoeken wélk nummer bij deze titel hoort, in plaats van
        //    blind te zoeken. Via het soundtrack-album (de albumnaam moet de
        //    filmnaam bevatten) of via Wikipedia, dat de titelsong noemt.
        //    Duurt iets langer, maar de zoekopdracht is daarna gericht en de
        //    koppeling klopt vrijwel altijd.
        let songnaam = null;
        try {
            const uitZoek = await soundtrack.zoekVoorTitel(t);
            if (uitZoek && (uitZoek.songnaam || uitZoek.alleenSongnaam || uitZoek.tracknaam)) {
                songnaam = uitZoek.alleenSongnaam || uitZoek.songnaam || uitZoek.tracknaam;
                log({ titel: t.naam, bron: `soundtrack/${uitZoek.via || 'wikipedia'}`, songnaam });
            }
        } catch (err) {
            log({ titel: t.naam, bron: 'soundtrack', fout: err.message });
        }

        // 2) YouTube is de bron waaruit gedownload wordt: daar staat vrijwel
        //    elke intro en titelsong, ook de Nederlandse. Kennen we de naam
        //    van de titelsong, dan zoekt YouTube daar eerst gericht op.
        try {
            let keuze = await ytzoek.zoekVoorTitel(t, { pauzeMs: 250, songnaam });
            // Extra slot op de deur: hoort deze video echt bij deze titel?
            if (keuze) {
                // Staat de titelsong die Wikipedia bij déze titel noemt in de
                // videotitel, dan is de koppeling al bewezen — de filmnaam
                // hoeft er dan niet ook nog in te staan.
                const viaSong = Boolean(keuze._viaSong);
                const lokaleControle = pastBijTitel(t, {
                    tracknaam: keuze.titel,
                    artiest: keuze.kanaal,
                    bevestigd: viaSong,
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
                // Nu er echt een betrouwbare treffer is, voegen we die toe
                // naast bestaande fallbacks. De engine roteert daarna de
                // minst gespeelde kandidaat.
                const bevestigdeSong = keuze._viaSong ? songnaam : null;
                if (force) {
                    await vervangTracks(titelId, (client) =>
                        voegYoutubeTrackToe(titelId, keuze, client, bevestigdeSong),
                    );
                } else {
                    await voegYoutubeTrackToe(titelId, keuze, pool, bevestigdeSong);
                }
                metTrack++;
                gelukt = true;
                log({
                    titel: t.naam,
                    bron: bevestigdeSong ? 'youtube/titelsong' : 'youtube',
                    gevonden: keuze.titel,
                    views: keuze.views ?? null,
                });
            }
        } catch (err) {
            log({ titel: t.naam, bron: 'youtube', fout: err.message });
        }

        if (!gelukt) {
            zonder.push(t.naam);
            await meldOntbrekendeTrack(titelId).catch((err) =>
                log({ titel: t.naam, bron: 'database', fout: err.message }),
            );
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
                  WHERE NOT EXISTS (
                      SELECT 1 FROM tracks x
                       WHERE x.titel_id = t.id AND x.werkt = true
                         AND x.preview_url IS NOT NULL AND x.preview_url <> ''
                         AND (x.bron = 'youtube' OR
                              (x.bron = 'lokaal' AND x.itunes_track_id IS NULL
                               AND x.download_status = 'available'))
                  )`,
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
