// =====================================================================
// Download een toegestane audiopreview naar het lokale /media-volume.
//
// Dit script downloadt uitsluitend expliciet door de admin aangewezen
// YouTube-tracks. Zo kan VenTune lokaal afspelen zonder tijdens een spel
// afhankelijk te zijn van YouTube of iTunes.
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
const { bestandGezondheid } = require('../server/lib/media-health');

const args = process.argv.slice(2);
const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(MEDIA_DIR, 'downloads');
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_YOUTUBE_SECONDS = 5 * 60;
const MAX_AUDIO_TOLERANCE_SECONDS = 1;
const execFileAsync = promisify(execFile);

const YOUTUBE_MIN_INTERVAL_MS = Math.max(
    100,
    Number(process.env.YOUTUBE_MIN_INTERVAL_MS) || 250,
);
let youtubeVolgendeDownload = 0;
let youtubeDownloadKeten = Promise.resolve();
let youtubeDownloadBlokkadeTot = 0;
let youtubeDownloadBlokkadePogingen = 0;

async function wachtOpYoutubeDownload() {
    const ticket = youtubeDownloadKeten.then(async () => {
        const doel = Math.max(youtubeDownloadBlokkadeTot, youtubeVolgendeDownload);
        const resterend = doel - Date.now();
        if (resterend > 0) {
            await new Promise((resolve) => setTimeout(resolve, resterend));
        }
        youtubeVolgendeDownload = Date.now() + YOUTUBE_MIN_INTERVAL_MS;
    });
    youtubeDownloadKeten = ticket.catch(() => {});
    await ticket;
}

function markeerYoutubeDownloadRateLimit(err) {
    const melding = String(err?.stderr || err?.message || '');
    if (!/\b(403|429)\b|rate limit|too many requests/i.test(melding)) return;
    youtubeDownloadBlokkadePogingen = Math.min(6, youtubeDownloadBlokkadePogingen + 1);
    const wacht = Math.min(5 * 60 * 1000, 4000 * (2 ** (youtubeDownloadBlokkadePogingen - 1)));
    youtubeDownloadBlokkadeTot = Date.now() + wacht + Math.floor(Math.random() * 1500);
}

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

/** Herken Apple/iTunes-previewbronnen, ook nadat ze lokaal zijn opgeslagen. */
function isAppleAudioUrl(url) {
    try {
        const u = new URL(String(url || ''));
        const host = u.hostname.toLowerCase();
        return host === 'itunes.apple.com'
            || host.endsWith('.itunes.apple.com')
            || host === 'apple.com'
            || host.endsWith('.apple.com')
            || host.endsWith('.mzstatic.com');
    } catch {
        return false;
    }
}

/**
 * Een lokaal bestand kan een oude iTunes-preview zijn. Alleen naar de
 * extensie kijken is hiervoor fout: een iTunes-preview kan ook als m4a zijn
 * opgeslagen. De databasebron en de oorspronkelijke URL zijn leidend.
 */
function isAppleTrack(track) {
    if (!track) return false;
    if (String(track.bron || '').toLowerCase() === 'itunes') return true;
    if (track.itunes_track_id !== null
        && track.itunes_track_id !== undefined
        && String(track.itunes_track_id).trim() !== '') return true;
    return isAppleAudioUrl(track.bron_url) || isAppleAudioUrl(track.preview_url);
}

function isSpeelbareLokaleTrack(track) {
    return track?.bron === 'lokaal'
        && track.download_status === 'available'
        && !isAppleTrack(track);
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
    const fout = 'iTunes/Apple-preview wordt niet gedownload: dit zijn korte fragmenten. Gebruik een gecontroleerde YouTube-bron of upload een volledig audiobestand.';
    if (!droog) await markeerMislukt(track.id, fout);
    throw new Error(fout);
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

/** Controleer vooraf of de bron nog bestaat, zonder audio te downloaden. */
async function controleerYoutubeUrl(track) {
    const url = youtubeUrl(track);
    if (!url) throw new Error('Geen geldige YouTube-bron-URL.');
    await wachtOpYoutubeDownload();
    try {
        await execFileAsync(
            'yt-dlp',
            ['--no-playlist', '--simulate', '--skip-download', '--print', 'id', url],
            { timeout: 45000, maxBuffer: 512 * 1024 },
        );
    } catch (err) {
        markeerYoutubeDownloadRateLimit(err);
        throw err;
    }
    return { bestaat: true, url };
}

async function controleerTrackUrl(track) {
    if (isAppleTrack(track)) {
        throw new Error('iTunes/Apple-preview uitgesloten: dit is geen volledig nummer.');
    }
    // Een lokale, beschikbare kopie is de bron van waarheid. Controleer dan
    // nooit meer de oorspronkelijke YouTube/iTunes-URL; die kan later worden
    // verwijderd zonder dat het spel daardoor breekt.
    if (isSpeelbareLokaleTrack(track)
        && await lokaalBestandBeschikbaar(track)) {
        return { bestaat: true, lokaal: true, url: track.preview_url };
    }
    if (track.bron === 'youtube' || (track.bron === 'lokaal' && youtubeUrl(track))) {
        return controleerYoutubeUrl(track);
    }
    throw new Error('Alleen YouTube is een toegestane downloadbron; iTunes is uitgeschakeld.');
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

/** Lees de werkelijke speelduur uit de container, niet uit de bestandsextensie. */
async function audioDuurInSeconden(bestand) {
    const { stdout } = await execFileAsync(
        'ffprobe',
        [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            bestand,
        ],
        { timeout: 30000, maxBuffer: 128 * 1024 },
    );
    const duur = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(duur) || duur <= 0) {
        throw new Error('Audiobestand heeft geen geldige speelduur.');
    }
    return duur;
}

/**
 * YouTube-downloads zijn volledige nummers zolang ze korter dan vijf minuten
 * zijn. Langere bronnen worden exact op vijf minuten afgeknipt. Een korte
 * iTunes-preview wordt hier nooit doorheen gehaald: die wordt eerder op bron
 * uitgesloten.
 */
async function begrensAudioOpVijfMinuten(bestand) {
    let duur = await audioDuurInSeconden(bestand);
    if (duur <= MAX_YOUTUBE_SECONDS + MAX_AUDIO_TOLERANCE_SECONDS) {
        return Math.min(duur, MAX_YOUTUBE_SECONDS);
    }

    const extensie = path.extname(bestand) || '.mp3';
    const tijdelijk = `${bestand}.max5-${process.pid}${extensie}`;
    try {
        await execFileAsync(
            'ffmpeg',
            [
                '-hide_banner', '-loglevel', 'error', '-y',
                '-i', bestand,
                '-t', String(MAX_YOUTUBE_SECONDS),
                '-map', '0:a:0',
                '-c:a', 'copy',
                tijdelijk,
            ],
            { timeout: 60000, maxBuffer: 512 * 1024 },
        );
        await fs.rename(tijdelijk, bestand);
    } catch (err) {
        await fs.unlink(tijdelijk).catch(() => {});
        throw new Error(`Audio kon niet tot maximaal vijf minuten worden begrensd: ${err.message}`);
    }
    duur = await audioDuurInSeconden(bestand);
    if (duur > MAX_YOUTUBE_SECONDS + MAX_AUDIO_TOLERANCE_SECONDS) {
        throw new Error(`Gedownload nummer duurt ${Math.ceil(duur)} seconden en kon niet tot vijf minuten worden begrensd.`);
    }
    return Math.min(duur, MAX_YOUTUBE_SECONDS);
}

/** Controleer alle lokale tracks en synchroniseer status/hash met de disk. */
async function controleerLokaleBestanden({ onProgress = null, isGeannuleerd = () => false } = {}) {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.bron, tr.preview_url, tr.bestand_pad, tr.audio_sha256,
                tr.download_status, tr.itunes_track_id, tr.bron_url, t.naam
           FROM tracks tr JOIN titels t ON t.id = tr.titel_id
          WHERE tr.bron = 'lokaal' OR tr.download_status = 'available'
          ORDER BY tr.id`,
    );
    let goed = 0;
    let ontbreekt = 0;
    let gewijzigd = 0;
    let geannuleerd = false;
    const fouten = [];
    for (const [index, track] of rows.entries()) {
        if (isGeannuleerd()) {
            geannuleerd = true;
            break;
        }
        if (isAppleTrack(track)) {
            const fout = 'Oude iTunes-preview uitgesloten; vervang deze door een volledige YouTube-download of eigen upload.';
            fouten.push({ id: track.id, naam: track.naam, fout });
            await pool.query(
                `UPDATE tracks SET werkt = false, download_status = 'failed',
                        media_controle_op = now(), media_melding = $2,
                        download_melding = $2
                  WHERE id = $1`,
                [track.id, fout],
            );
            onProgress?.({ verwerkt: index + 1, totaal: rows.length, huidige: track.naam, goed, ontbreekt, gewijzigd });
            continue;
        }
        const gezondheid = await bestandGezondheid(track);
        if (gezondheid.aanwezig && gezondheid.hashGelijk) {
            goed++;
            await pool.query(
                `UPDATE tracks SET media_controle_op = now(), media_melding = NULL,
                        download_status = 'available', audio_sha256 = COALESCE($2, audio_sha256)
                  WHERE id = $1`,
                [track.id, gezondheid.sha256],
            );
        } else {
            if (gezondheid.aanwezig && !gezondheid.hashGelijk) gewijzigd++;
            else ontbreekt++;
            const fout = gezondheid.fout || 'Lokaal bestand niet bruikbaar.';
            fouten.push({ id: track.id, naam: track.naam, fout });
            await pool.query(
                `UPDATE tracks SET media_controle_op = now(), media_melding = $2,
                        download_status = 'failed'
                  WHERE id = $1`,
                [track.id, fout.slice(0, 500)],
            );
        }
        onProgress?.({ verwerkt: index + 1, totaal: rows.length, huidige: track.naam, goed, ontbreekt, gewijzigd });
    }
    return { verwerkt: geannuleerd ? goed + ontbreekt + gewijzigd : rows.length, goed, ontbreekt, gewijzigd, geannuleerd, fouten: fouten.slice(0, 200) };
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
        await wachtOpYoutubeDownload();
        try {
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
        } catch (err) {
            markeerYoutubeDownloadRateLimit(err);
            throw err;
        }
        const info = await fs.stat(bestand);
        if (!info.size || info.size > MAX_BYTES) {
            throw new Error(`Gedownload bestand is leeg of groter dan ${MAX_BYTES} bytes.`);
        }
        const duur = await begrensAudioOpVijfMinuten(bestand);
        const naBegrenzen = await fs.stat(bestand);
        if (!naBegrenzen.size || naBegrenzen.size > MAX_BYTES) {
            throw new Error(`Audio na begrenzen is leeg of groter dan ${MAX_BYTES} bytes.`);
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
        console.log(`OK   ${track.id}: ${naam} → ${bestand} (${naBegrenzen.size} bytes, ${duur.toFixed(1)} s)`);
    } catch (err) {
        await markeerMislukt(track.id, err.message);
        throw new Error(`YouTube lokaal opslaan mislukt: ${err.message}`);
    }
}

async function downloadTrack(track, droog = false) {
    if (isAppleTrack(track)) {
        throw new Error('iTunes/Apple-preview uitgesloten: dit is geen volledig nummer.');
    }
    if (isSpeelbareLokaleTrack(track)
        && await lokaalBestandBeschikbaar(track)) {
        return { ok: true, lokaal: true, preview_url: track.preview_url };
    }
    if (track.bron === 'youtube' || (track.bron === 'lokaal' && youtubeUrl(track))) {
        return downloadYoutubeTrack({ ...track, bron: 'youtube' }, droog);
    }
    throw new Error('Deze track heeft geen herstelbare downloadbron.');
}

async function main() {
    const id = optie('track');
    const alles = args.includes('--all');
    const droog = args.includes('--droog');
    if (!id && !alles) {
        throw new Error('Gebruik --track ID of --all.');
    }

    const params = [];
    let where = `tr.bron = 'youtube' AND tr.preview_url IS NOT NULL`;
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
    if (!rows.length) throw new Error('Geen passende YouTube-track gevonden.');

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
    controleerYoutubeUrl,
    controleerTrackUrl,
    lokaalBestandBeschikbaar,
    isAppleAudioUrl,
    isAppleTrack,
    isSpeelbareLokaleTrack,
    controleerLokaleBestanden,
};
