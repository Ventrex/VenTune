// =====================================================================
// Download een toegestane audiopreview naar het lokale /media-volume.
//
// Dit script start nooit automatisch. Het downloadt uitsluitend bestaande
// Apple/iTunes-preview-URL's of expliciet door de admin aangewezen YouTube-
// tracks. Zo kan VenTune later lokaal afspelen zonder blind zoekresultaten
// of willekeurige externe URL's als downloader te gebruiken.
//
// Gebruik:
//   node /app/seed/download-track.js --track 42
//   node /app/seed/download-track.js --all
//   node /app/seed/download-track.js --track 42 --droog
// =====================================================================

const crypto = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../server/db/pool');

const args = process.argv.slice(2);
const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(MEDIA_DIR, 'downloads');
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_YOUTUBE_SECONDS = 5 * 60;
const execFileAsync = promisify(execFile);

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

async function downloadAppleTrack(track, droog = false) {
    if (!isToegestanePreview(track.preview_url)) {
        if (!droog) {
            await markeerMislukt(track.id, 'Bron is geen toegestane iTunes/Apple-preview-URL.');
        }
        throw new Error('Bron is geen toegestane iTunes/Apple-preview-URL.');
    }

    const naam = String(track.naam || track.tracknaam || 'track');
    const bestandsnaam = `${veiligeNaam(naam)}-${track.id}.m4a`;
    const bestand = path.join(DOWNLOAD_DIR, bestandsnaam);
    const lokaal = `/media/downloads/${bestandsnaam}`;
    if (droog) {
        console.log(`DRY  ${track.id}: ${naam} → ${bestand}`);
        return;
    }

    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
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
    console.log(`OK   ${track.id}: ${naam} → ${bestand} (${bytes.length} bytes)`);
}

function youtubeUrl(track) {
    try {
        const bron = new URL(String(track.bron_url || ''));
        const host = bron.hostname.toLowerCase();
        const toegestaan = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
        if (toegestaan && host === 'youtu.be' && /^[A-Za-z0-9_-]{11}$/.test(bron.pathname.slice(1))) {
            return `https://www.youtube.com/watch?v=${bron.pathname.slice(1)}`;
        }
        const id = bron.searchParams.get('v');
        if (toegestaan && bron.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(id || '')) {
            return `https://www.youtube.com/watch?v=${id}`;
        }
    } catch {
        /* fallback naar het opgeslagen video-id */
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(String(track.preview_url || ''))) {
        return `https://www.youtube.com/watch?v=${String(track.preview_url)}`;
    }
    return null;
}

/** Controleer of een eerder opgeslagen lokale kopie nog echt op disk staat. */
async function lokaalBestandBeschikbaar(track) {
    if (track?.bron !== 'lokaal' || !track.preview_url) return false;
    const pad = String(track.preview_url);
    const prefix = '/media/';
    const absoluut = pad.startsWith(prefix)
        ? path.join(MEDIA_DIR, pad.slice(prefix.length))
        : pad;
    try {
        const info = await fs.stat(absoluut);
        return info.isFile() && info.size > 0;
    } catch {
        return false;
    }
}

/**
 * Downloadt alleen een expliciet door de admin aangewezen YouTube-track.
 * yt-dlp en ffmpeg moeten in de servercontainer aanwezig zijn. De lokale
 * kopie wordt audio (mp3), zodat browsers hem snel en zonder iframe kunnen
 * afspelen.
 */
async function downloadYoutubeTrack(track, droog = false) {
    const bronUrl = youtubeUrl(track);
    if (!bronUrl) {
        const fout = 'Track heeft geen geldig YouTube-video-id of bron-URL.';
        if (!droog) await markeerMislukt(track.id, fout);
        throw new Error(fout);
    }

    const naam = String(track.naam || track.tracknaam || 'track');
    const bestandsnaam = `${veiligeNaam(naam)}-${track.id}.mp3`;
    const bestand = path.join(DOWNLOAD_DIR, bestandsnaam);
    const lokaal = `/media/downloads/${bestandsnaam}`;
    if (droog) {
        console.log(`DRY  ${track.id}: ${naam} → ${bestand}`);
        return;
    }

    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
    await pool.query(
        `UPDATE tracks SET download_status = 'pending', download_melding = NULL WHERE id = $1`,
        [track.id],
    );

    try {
        const start = Math.max(0, Number(track.start_seconde) || 0);
        const eind = start + MAX_YOUTUBE_SECONDS;
        await execFileAsync(
            'yt-dlp',
            [
                '--no-playlist',
                '--download-sections', `*${start}-${eind}`,
                '--force-keyframes-at-cuts',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '5',
                '--no-part',
                '--output', bestand,
                bronUrl,
            ],
            { timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
        );
        const info = await fs.stat(bestand);
        if (!info.size || info.size > MAX_BYTES) {
            throw new Error(`Gedownload bestand is leeg of groter dan ${MAX_BYTES} bytes.`);
        }
        const bytes = await fs.readFile(bestand);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        await pool.query(
            `UPDATE tracks
                SET bron = 'lokaal', preview_url = $2, bestand_pad = $2,
                    bron_url = $3, download_status = 'available',
                    download_melding = NULL, audio_sha256 = $4,
                    gedownload_op = now(), verificatie_score = GREATEST(verificatie_score, 0.95),
                    verificatie_reden = COALESCE(verificatie_reden, 'lokale admin-download van YouTube-track')
              WHERE id = $1`,
            [track.id, lokaal, bronUrl, hash],
        );
        console.log(`OK   ${track.id}: ${naam} → ${bestand} (${info.size} bytes)`);
    } catch (err) {
        await markeerMislukt(track.id, err.message);
        throw new Error(`YouTube lokaal opslaan mislukt: ${err.message}`);
    }
}

async function downloadTrack(track, droog = false) {
    if (track.bron === 'youtube') return downloadYoutubeTrack(track, droog);
    if (track.bron === 'itunes') return downloadAppleTrack(track, droog);
    throw new Error('Deze track is al lokaal of heeft geen ondersteunde downloadbron.');
}

async function main() {
    const id = optie('track');
    const alles = args.includes('--all');
    const droog = args.includes('--droog');
    if (!id && !alles) {
        throw new Error('Gebruik --track ID of --all.');
    }

    const params = [];
    let where = `(tr.bron = 'itunes' OR tr.bron = 'youtube') AND tr.preview_url IS NOT NULL`;
    if (id) {
        params.push(Number(id));
        where += ` AND tr.id = $${params.length}`;
    }
    const { rows } = await pool.query(
        `SELECT tr.id, tr.preview_url, tr.bron, tr.bron_url, tr.start_seconde, t.naam
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          WHERE ${where}
          ORDER BY tr.id`,
        params,
    );
    if (!rows.length) throw new Error('Geen passende YouTube- of iTunes-track gevonden.');

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

module.exports = {
    downloadTrack,
    downloadYoutubeTrack,
    isToegestanePreview,
    youtubeUrl,
    lokaalBestandBeschikbaar,
};
