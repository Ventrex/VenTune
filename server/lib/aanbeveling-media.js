// =====================================================================
// Media voor aanbevelingen: voorbeeld zoeken (YouTube) en — pas na een
// "goed"-swipe — het fragment downloaden en er een speelbare titel+track
// van maken.
//
// Hergebruikt de bestaande YouTube-zoeker (ytzoek) en yt-dlp/ffmpeg die al
// in de servercontainer staan. Zo blijft de bron van waarheid de tracks-
// tabel, net als bij de gewone import.
// =====================================================================

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ytzoek = require('./ytzoek');
const { mediaWebpad } = require('./media-naming');
const { pool } = require('../db/pool');
const logger = require('./logger');

const execFileAsync = promisify(execFile);

const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const FRAGMENT_SECONDEN = 45;
const INTRO_OVERSLAAN = 5; // korte gesproken intro's/reclame aan begin overslaan      // ruim genoeg om te raden
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Zoek een voorbeeld-video voor een aanbeveling.
 * @returns {Promise<{videoId:string, titel:string, duurSeconden:number}|null>}
 */
async function zoekVoorbeeld(aanbeveling) {
    const term = (aanbeveling.youtube_zoekterm || '').trim()
        || `${aanbeveling.artiest} ${aanbeveling.tracknaam}`.trim()
        || `${aanbeveling.titel || ''} soundtrack`.trim();
    if (!term) return null;
    try {
        const resultaten = await ytzoek.zoek(term, { limiet: 5 });
        const afgekeurd = new Set(aanbeveling.afgekeurde_bronnen || []);
        const beste = (resultaten || []).find((r) => r.videoId && !afgekeurd.has(r.videoId)
            && ytzoek.isLatijnsSchrift(r.titel)
            && (!r.duurSeconden || r.duurSeconden < 15 * 60));
        if (!beste) return null;
        return { videoId: beste.videoId, titel: beste.titel, duurSeconden: beste.duurSeconden || 0 };
    } catch (err) {
        logger.waarschuwing('Voorbeeld zoeken mislukt', { melding: err.message });
        return null;
    }
}

// Download alleen bij het opvragen van een luistervoorbeeld. Hergebruik het
// bestand bij opnieuw openen; zo hoeft de browser geen YouTube-iframe te laden.
const previewDownloads = new Map();
async function lokaalVoorbeeld(aanbeveling) {
    const id = Number(aanbeveling?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ongeldige aanbeveling.');
    const naam = `aanbeveling-${id}.mp3`;
    const map = path.join(MEDIA_DIR, 'previews');
    const bestand = path.join(map, naam);
    const url = `/media/previews/${naam}`;
    const bestaand = async () => {
        try {
            const stat = await fs.stat(bestand);
            return stat.size > 0 && stat.size <= MAX_BYTES;
        } catch { return false; }
    };
    if (await bestaand()) return { audioUrl: url };
    if (previewDownloads.has(id)) return previewDownloads.get(id);
    const taak = (async () => {
        const bron = await zoekVoorbeeld(aanbeveling);
        if (!bron) throw new Error('Geen geschikt luistervoorbeeld gevonden.');
        await fs.mkdir(map, { recursive: true });
        const tmp = path.join(map, `aanbeveling-${id}-${Date.now()}.mp3`);
        try {
            await execFileAsync('yt-dlp', [
                '--no-playlist', '--download-sections', `*${INTRO_OVERSLAAN}-${INTRO_OVERSLAAN + FRAGMENT_SECONDEN}`,
                '--force-keyframes-at-cuts', '--extract-audio',
                '--audio-format', 'mp3', '--audio-quality', '5',
                '--no-part', '--output', tmp,
                `https://www.youtube.com/watch?v=${bron.videoId}`,
            ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
            const stat = await fs.stat(tmp);
            if (stat.size < 1 || stat.size > MAX_BYTES) throw new Error('Luistervoorbeeld is leeg of te groot.');
            await fs.rename(tmp, bestand);
            await pool.query('UPDATE aanbevelingen SET voorbeeld_bron = $2 WHERE id = $1', [id, bron.videoId]);
            return { audioUrl: url };
        } finally {
            await fs.rm(tmp, { force: true }).catch(() => {});
        }
    })();
    previewDownloads.set(id, taak);
    try { return await taak; }
    finally { previewDownloads.delete(id); }
}

/** Verwijder een afgekeurd luisterfragment; voorkom dat dezelfde video opnieuw gekozen wordt. */
async function keurMp3Af(id) {
    if (previewDownloads.has(id)) {
        await previewDownloads.get(id).catch(() => {});
    }
    await fs.rm(path.join(MEDIA_DIR, 'previews', `aanbeveling-${id}.mp3`), { force: true });
}

/** Vind of maak de titel die bij een aanbeveling hoort. */
async function vindOfMaakTitel(a) {
    if (a.soort === 'kerst') {
        // Een kerstnummer is zelf de te raden titel (type 'muziek').
        const naam = a.tracknaam;
        const { rows: best } = await pool.query(
            `SELECT id FROM titels WHERE lower(naam) = lower($1) AND type = 'muziek' LIMIT 1`, [naam]);
        if (best[0]) return best[0].id;
        const { rows } = await pool.query(
            `INSERT INTO titels (naam, type, jaar, genres, taal, themas, muziek_genres)
             VALUES ($1, 'muziek', $2, ARRAY['Kerst'], 'nl', ARRAY['Kerst'], $3)
             RETURNING id`,
            [naam, Number.isFinite(a.jaar) ? a.jaar : null, Array.isArray(a.muziek_genres) ? a.muziek_genres : []]);
        return rows[0].id;
    }
    // film/serie
    const type = a.type === 'serie' ? 'serie' : 'film';
    const { rows: best } = await pool.query(
        `SELECT id FROM titels WHERE lower(naam) = lower($1) AND type = $2 LIMIT 1`, [a.titel, type]);
    if (best[0]) return best[0].id;
    const { rows } = await pool.query(
        `INSERT INTO titels (naam, type, jaar, genres, taal, themas, studio, muziek_genres)
         VALUES ($1, $2, $3, $4, 'nl', $5, $6, $7) RETURNING id`,
        [a.titel, type, Number.isFinite(a.jaar) ? a.jaar : null,
         Array.isArray(a.genres) ? a.genres : [],
          Array.isArray(a.themas) ? a.themas : [], a.studio || null,
          Array.isArray(a.muziek_genres) ? a.muziek_genres : []]);
    return rows[0].id;
}

/**
 * Verwerk een goedgekeurde aanbeveling: download het fragment en maak er
 * een speelbare titel + track van. Markeert de aanbeveling als 'toegevoegd'.
 * @returns {Promise<{ok:boolean, titelId?:number, error?:string}>}
 */
async function verwerkGoed(aanbevelingId) {
    const { rows } = await pool.query('SELECT * FROM aanbevelingen WHERE id = $1', [aanbevelingId]);
    const a = rows[0];
    if (!a) return { ok: false, error: 'Aanbeveling niet gevonden.' };

    // 1. Reeds klaargezet luistervoorbeeld gebruiken als bronbestand.
    const voorbereid = await lokaalVoorbeeld(a).catch(() => null);

    // 2. Voorbeeld/bron bepalen.
    const voorbeeld = a.voorbeeld_bron
        ? { videoId: a.voorbeeld_bron }
        : await zoekVoorbeeld(a);
    if (!voorbereid && (!voorbeeld || !voorbeeld.videoId)) {
        return { ok: false, error: 'Geen YouTube-bron gevonden om te downloaden.' };
    }

    // 2. Titel vinden/maken.
    const titelId = await vindOfMaakTitel(a);
    const titelRij = (await pool.query('SELECT * FROM titels WHERE id = $1', [titelId])).rows[0];

    // 3. Downloadpad bepalen (zelfde conventie als de gewone import).
    const media = mediaWebpad(MEDIA_DIR, titelRij, '', '.mp3', `aanb${a.id}`);
    await fs.mkdir(media.basis, { recursive: true });
    const bronUrl = voorbeeld?.videoId ? `https://www.youtube.com/watch?v=${voorbeeld.videoId}` : null;

    // 4. Geen tweede download als het luistervoorbeeld al klaarstaat.
    try {
        if (voorbereid) {
            await fs.copyFile(path.join(MEDIA_DIR, 'previews', `aanbeveling-${a.id}.mp3`), media.bestand);
        } else await execFileAsync('yt-dlp', [
            '--no-playlist',
            '--download-sections', `*0-${FRAGMENT_SECONDEN}`,
            '--force-keyframes-at-cuts',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '5',
            '--no-part',
            '--output', media.bestand,
            bronUrl,
        ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
        return { ok: false, error: 'Download mislukt: ' + String(err.message).slice(0, 200) };
    }

    // 5. Controleren dat het bestand er is en niet te groot.
    let info;
    try { info = await fs.stat(media.bestand); }
    catch { return { ok: false, error: 'Gedownload bestand niet gevonden.' }; }
    if (!info.size || info.size > MAX_BYTES) {
        return { ok: false, error: 'Gedownload bestand is leeg of te groot.' };
    }

    // 6. Track aanmaken: lokaal, beschikbaar, gecontroleerd (jij keurde het goed).
    const tracknaam = a.tracknaam || titelRij.naam;
    const artiest = a.artiest || 'Onbekend';
    await pool.query(
        `INSERT INTO tracks
            (titel_id, bron, preview_url, bestand_pad, bron_url, start_seconde,
             tracknaam, artiest, werkt, gecontroleerd, download_status,
             gedownload_op, verificatie_score, verificatie_reden)
         VALUES ($1, 'lokaal', $2, $2, $3, 0, $4, $5, true, true, 'available',
                 now(), 1.0, 'Goedgekeurd via swipe door beheerder')`,
        [titelId, media.lokaal, bronUrl, tracknaam, artiest]);

    // 7. Aanbeveling afronden.
    await pool.query(
        `UPDATE aanbevelingen SET status = 'toegevoegd', titel_id = $2,
                voorbeeld_bron = $3, beoordeeld_op = now()
         WHERE id = $1`,
        [a.id, titelId, voorbeeld?.videoId || a.voorbeeld_bron || null]);

    logger.info('Aanbeveling toegevoegd als speelbare titel', { id: a.id, titelId });
    return { ok: true, titelId };
}

module.exports = { zoekVoorbeeld, lokaalVoorbeeld, keurMp3Af, verwerkGoed };
