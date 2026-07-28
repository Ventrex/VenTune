// =====================================================================
// Diagnose voor de soundtrack-route: welk nummer hóórt er bij deze film
// of serie, en langs welke weg is dat vastgesteld?
//
// Zo kun je per titel controleren of het klopt vóórdat je een hele import
// draait. Er wordt niets in de database gewijzigd.
//
// Gebruik (in de servercontainer):
//   node /app/seed/diagnose-soundtrack.js "100% Coco"
//   node /app/seed/diagnose-soundtrack.js "Gooische Vrouwen" --jaar 2011
//   node /app/seed/diagnose-soundtrack.js --db --limit 10
// =====================================================================

const { pool } = require('../server/db/pool');
const soundtrack = require('../server/lib/soundtrack');
const ytzoek = require('../server/lib/ytzoek');
const { pastBijTitel } = require('../server/lib/trackcheck');

const args = process.argv.slice(2);
const UITDB = args.includes('--db');

function optie(naam) {
    const i = args.indexOf(naam);
    return i >= 0 ? args[i + 1] : null;
}

const LIMIET = Number(optie('--limit') || 5);
const JAAR = optie('--jaar') ? Number(optie('--jaar')) : null;
const NAAM = args.find((a) => !a.startsWith('--') && a !== optie('--limit') && a !== optie('--jaar'));

async function haalTitels() {
    if (UITDB) {
        const { rows } = await pool.query(
            `SELECT id, naam, aliassen, type, taal, jaar
               FROM titels t
              WHERE NOT EXISTS (SELECT 1 FROM tracks x
                                 WHERE x.titel_id = t.id AND x.werkt)
              ORDER BY populariteit DESC NULLS LAST, id
              LIMIT $1`,
            [LIMIET],
        );
        return rows;
    }
    if (!NAAM) return [];
    const { rows } = await pool.query(
        `SELECT id, naam, aliassen, type, taal, jaar FROM titels
          WHERE naam ILIKE $1 ORDER BY id LIMIT $2`,
        [`%${NAAM}%`, LIMIET],
    );
    if (rows.length > 0) return rows;
    // Niet in de database? Dan gewoon los uitproberen.
    return [{ naam: NAAM, aliassen: [], type: 'film', taal: 'nl', jaar: JAAR }];
}

async function main() {
    const titels = await haalTitels();
    if (titels.length === 0) {
        console.log(
            'Geef een titel op, of gebruik --db voor titels zonder muziek:\n' +
                '  node /app/seed/diagnose-soundtrack.js "100% Coco"\n' +
                '  node /app/seed/diagnose-soundtrack.js --db --limit 10',
        );
        await pool.end();
        return;
    }

    for (const t of titels) {
        console.log(`\n══ ${t.naam}${t.jaar ? ` (${t.jaar})` : ''} — ${t.type}/${t.taal}`);

        // Stap 1: het soundtrack-album.
        let albums = [];
        try {
            albums = await soundtrack.zoekAlbums(t);
        } catch (err) {
            console.log(`   albums: FOUT ${err.message}`);
        }
        if (albums.length === 0) {
            console.log('   albums: geen album gevonden dat naar deze titel heet');
        } else {
            for (const a of albums.slice(0, 3)) {
                console.log(`   album:  "${a.album}" — ${a.artiest} (${a.jaar || '?'})`);
            }
        }

        // Stap 2: de naam van de titelsong volgens Wikipedia.
        let songnaam = null;
        try {
            songnaam = await soundtrack.songNaamViaWikipedia(t);
        } catch (err) {
            console.log(`   wiki:   FOUT ${err.message}`);
        }
        console.log(`   wiki:   ${songnaam ? `titelsong "${songnaam}"` : 'geen titelsong genoemd'}`);

        // Wat kiest de import uiteindelijk?
        let keuze = null;
        try {
            keuze = await soundtrack.zoekVoorTitel(t);
        } catch (err) {
            console.log(`   keuze:  FOUT ${err.message}`);
        }
        const gevondenSong =
            (keuze && (keuze.alleenSongnaam || keuze.songnaam || keuze.tracknaam)) || null;
        if (gevondenSong) {
            console.log(
                `   KEUZE:  titelsong "${gevondenSong}"` +
                    (keuze.artiest ? ` — ${keuze.artiest}` : '') +
                    ` [via ${keuze.via || 'wikipedia'}${keuze.onzeker ? ', onzeker' : ''}]`,
            );
        } else {
            console.log('   KEUZE:  niets — YouTube zoekt op de gewone manier');
        }

        // Wat kiest YouTube hiermee? Dat is de video die uiteindelijk als
        // MP3 gedownload wordt.
        try {
            const video = await ytzoek.zoekVoorTitel(t, {
                pauzeMs: 250,
                songnaam: gevondenSong,
            });
            if (video) {
                const past = pastBijTitel(t, {
                    tracknaam: video.titel,
                    artiest: video.kanaal,
                    bevestigd: Boolean(video._viaSong),
                }).past;
                console.log(
                    `   youtube: "${video.titel}" (${video.views ?? '?'} weergaven)` +
                        ` ${past ? '✓' : '✗ zou geweigerd worden'}` +
                        (video._viaSong ? ' — herkend aan de titelsong' : ''),
                );
                console.log(`            https://www.youtube.com/watch?v=${video.videoId}`);
            } else {
                console.log('   youtube: geen bruikbare video');
            }
        } catch (err) {
            console.log(`   youtube: FOUT ${err.message}`);
        }
    }

    console.log('\nKlopt de keuze? Draai dan de import voor deze titel:');
    console.log('  node /app/seed/import.js --db --titel "<naam>"');
    await pool.end();
}

main().catch(async (err) => {
    console.error('Diagnose mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
