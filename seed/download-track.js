// =====================================================================
// Download een toegestane audiopreview naar het lokale /media-volume.
//
// Dit script start nooit automatisch. Het downloadt uitsluitend Apple/iTunes
// preview-URL's die al in de database staan. Zo kan VenTune later lokaal
// afspelen zonder dat willekeurige externe URL's of ongeautoriseerde bronnen
// als downloader worden gebruikt.
//
// Gebruik:
//   node /app/seed/download-track.js --track 42
//   node /app/seed/download-track.js --all
//   node /app/seed/download-track.js --track 42 --droog
// =====================================================================

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../server/db/pool');

const args = process.argv.slice(2);
const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const MAX_BYTES = 50 * 1024 * 1024;

function optie(naam) {
    const index = args.indexOf(`--${naam}`);
    return index >= 0 ? args[index + 1] : null;
}

function isToegestanePreview(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        return (
            u.protocol === 'https:' &&
            (host.endsWith('.mzstatic.com') ||
                host === 'itunes.apple.com' ||
                host.endsWith('.itunes.apple.com') ||
                host === 'apple.com' ||
                host.endsWith('.apple.com'))
        );
    } catch {
        return false;
    }
}

function veiligeNaam(tekst) {
    return String(tekst || 'track')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'track';
}

async function markeerMislukt(id, melding) {
    await pool.query(
        `UPDATE tracks SET download_status = 'failed', download_melding = $2
          WHERE id = $1`,
        [id, String(melding).slice(0, 500)],
    );
}

async function downloadTrack(track, droog = false) {
    if (!isToegestanePreview(track.preview_url)) {
        if (!droog) {
            await markeerMislukt(track.id, 'Bron is geen toegestane iTunes/Apple-preview-URL.');
        }
        throw new Error('Bron is geen toegestane iTunes/Apple-preview-URL.');
    }

    const bestandsnaam = `${veiligeNaam(track.naam)}-${track.id}.m4a`;
    const bestand = path.join(MEDIA_DIR, bestandsnaam);
    const lokaal = `/media/${bestandsnaam}`;
    if (droog) {
        console.log(`DRY  ${track.id}: ${track.naam} → ${bestand}`);
        return;
    }

    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await pool.query(
        `UPDATE tracks SET download_status = 'pending', download_melding = NULL
          WHERE id = $1`,
        [track.id],
    );

    let response;
    try {
        response = await fetch(track.preview_url, {
            headers: { 'User-Agent': 'VenTune/1.0 local-preview-cache' },
        });
    } catch (err) {
        await markeerMislukt(track.id, err.message);
        throw err;
    }
    if (!response.ok) {
        const err = new Error(`Bron gaf HTTP ${response.status}.`);
        await markeerMislukt(track.id, err.message);
        throw err;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('audio/') && !contentType.includes('mp4')) {
        const err = new Error(`Bron gaf geen audio terug (${contentType}).`);
        await markeerMislukt(track.id, err.message);
        throw err;
    }

    const lengte = Number(response.headers.get('content-length') || 0);
    if (lengte > MAX_BYTES) {
        const err = new Error(`Bestand is groter dan ${MAX_BYTES} bytes.`);
        await markeerMislukt(track.id, err.message);
        throw err;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) {
        const err = new Error('Leeg of te groot audiobestand ontvangen.');
        await markeerMislukt(track.id, err.message);
        throw err;
    }

    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const tijdelijk = `${bestand}.part-${process.pid}`;
    try {
        await fs.writeFile(tijdelijk, bytes, { flag: 'w' });
        await fs.rename(tijdelijk, bestand);

        await pool.query(
            `UPDATE tracks
                SET bron = 'lokaal', preview_url = $2, bestand_pad = $2,
                    bron_url = $3, download_status = 'available',
                    download_melding = NULL, audio_sha256 = $4,
                    gedownload_op = now(), verificatie_score = GREATEST(verificatie_score, 0.95),
                    verificatie_reden = COALESCE(verificatie_reden, 'lokale iTunes-previewcache')
              WHERE id = $1`,
            [track.id, lokaal, track.preview_url, hash],
        );
    } catch (err) {
        await markeerMislukt(track.id, err.message);
        throw err;
    }
    console.log(`OK   ${track.id}: ${track.naam} → ${bestand} (${bytes.length} bytes)`);
}

async function main() {
    const id = optie('track');
    const alles = args.includes('--all');
    const droog = args.includes('--droog');
    if (!id && !alles) {
        throw new Error('Gebruik --track ID of --all.');
    }

    const params = [];
    let where = `t.bron = 'itunes' AND t.preview_url IS NOT NULL`;
    if (id) {
        params.push(Number(id));
        where += ` AND t.id = $${params.length}`;
    }
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, t.naam
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          WHERE ${where}
          ORDER BY tr.id`,
        params,
    );
    if (!rows.length) throw new Error('Geen passende iTunes-track gevonden.');

    let mislukt = 0;
    for (const track of rows) {
        try {
            await downloadTrack(track, droog);
        } catch (err) {
            mislukt++;
            console.error(`FOUT ${track.id}: ${err.message}`);
        }
    }
    if (mislukt) process.exitCode = 1;
    await pool.end();
}

if (require.main === module) {
    main().catch(async (err) => {
        console.error('Download gestopt:', err.message);
        await pool.end().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { downloadTrack, isToegestanePreview };
