// =====================================================================
// Beheer 2.0 — MP3's zoeken, laten kiezen door de AI en lokaal opslaan.
//
// 1. Per titel YouTube doorzoeken met de AI-zoekterm en het nummer.
// 2. De AI kiest uit de kandidaten de originele versie (of geen).
// 3. De bestaande downloadketen (yt-dlp → mp3, max 5 min) slaat hem op.
//
// Waarom iets mist staat altijd in titels.zoek_melding, zodat het in het
// beheer zichtbaar is. Een mislukking wacht steeds langer (6 u → 7 dagen)
// en staat daarna op 'opgegeven' tot de beheerder opnieuw laat zoeken of
// zelf een YouTube-link plaatst.
// =====================================================================

const { pool } = require('../db/pool');
const ytzoek = require('./ytzoek');
const bankAi = require('./bank-ai');
const bank = require('./bank');
const logger = require('./logger');
const { downloadTrack } = require('../../seed/download-track');

const WACHT_UREN = [6, 24, 72, 168];
const lopend = new Map(); // titelId -> { sinds, wat }
let pauzeTot = 0; // na een YouTube-blokkade of netwerkstoring even wachten

function gepauzeerd() { return pauzeTot > Date.now() ? pauzeTot : 0; }
function pauzeer(minuten = 15) { pauzeTot = Date.now() + minuten * 60 * 1000; }

function isBezig(titelId) { return lopend.has(Number(titelId)); }
function bezigeIds() { return [...lopend.keys()]; }

function videoIdUit(url) {
    const s = String(url || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

function zoektermen(t) {
    const nummer = [t.nummer_naam, t.nummer_artiest].filter(Boolean).join(' ');
    const extra = {
        film: `${t.naam} ${t.jaar || ''} main theme soundtrack`,
        serie: `${t.naam} intro theme song`,
        anime: `${t.naam} opening`,
        game: `${t.naam} ${t.nummer_naam || 'main theme'} OST`,
    }[t.categorie] || `${t.nummer_naam || t.naam} ${t.nummer_artiest || ''} official audio`;
    return [...new Set([t.yt_zoekterm, nummer && `${nummer}${bank.MUZIEK_CATEGORIEEN.has(t.categorie) ? ' official audio' : ''}`, extra]
        .map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 3))].slice(0, 3);
}

async function kandidatenVoor(t) {
    const afgekeurd = new Set(t.mp3_afgekeurd || []);
    const gezien = new Map();
    for (const term of zoektermen(t)) {
        if (gezien.size >= 10) break;
        const res = await ytzoek.zoek(term, { limiet: 8 });
        for (const r of res || []) {
            if (!r?.videoId || afgekeurd.has(r.videoId) || gezien.has(r.videoId)) continue;
            if (!ytzoek.isLatijnsSchrift(r.titel)) continue;
            if (r.duurSeconden && (r.duurSeconden < 15 || r.duurSeconden > 15 * 60)) continue;
            gezien.set(r.videoId, r);
        }
    }
    return [...gezien.values()].slice(0, 10);
}

async function markeerMislukt(t, reden, { tellen = true } = {}) {
    const pogingen = (Number(t.zoek_pogingen) || 0) + (tellen ? 1 : 0);
    const opgegeven = pogingen >= WACHT_UREN.length;
    const uren = WACHT_UREN[Math.min(pogingen, WACHT_UREN.length) - 1] || 6;
    await pool.query(
        `UPDATE titels SET zoek_status = $2, zoek_pogingen = $3, laatste_zoekpoging = now(),
                volgende_poging = now() + ($4 || ' hours')::interval, zoek_melding = $5
          WHERE id = $1`,
        [t.id, opgegeven ? 'opgegeven' : 'geen_kandidaat', pogingen, String(uren), String(reden).slice(0, 500)],
    );
    await bank.log(t.id, 'mp3', `MP3 niet gevonden: ${reden}`);
}

/** Track-rij aanmaken en via de bestaande keten lokaal opslaan. */
async function slaOp(t, video, { reden, handmatig = false }) {
    const bronUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    const { rows } = await pool.query(
        // Een AI-keuze wacht op een swipe van de beheerder; een eigen link
        // van de beheerder is meteen goedgekeurd.
        `INSERT INTO tracks (titel_id, bron, preview_url, bron_url, start_seconde, tracknaam, artiest,
                songnaam, youtube_titel, werkt, gecontroleerd, bevestigd, review_status, review_handmatig,
                verificatie_score, verificatie_reden, download_status, laatst_gecontroleerd_op, wacht_op_swipe)
         VALUES ($1, 'youtube', $2, $3, 0, $4, $5, $6, $7, true, true, true,
                 CASE WHEN $8 THEN 'goedgekeurd' ELSE 'open' END, $8,
                 $9, $10, 'pending', now(), NOT $8)
         RETURNING id`,
        [t.id, video.videoId, bronUrl, t.nummer_naam || t.naam, t.nummer_artiest || 'Onbekend',
            t.nummer_naam || null, video.titel || null, handmatig, handmatig ? 1 : 0.95,
            String(reden || '').slice(0, 400)],
    );
    const trackId = rows[0].id;
    try {
        await downloadTrack({
            id: trackId, preview_url: video.videoId, bron: 'youtube', bron_url: bronUrl, start_seconde: 0,
            // Titel- én video-id in de bestandsnaam: twee titels botsen nooit,
            // en een vervangende video krijgt een eigen bestand. yt-dlp
            // overschrijft een bestaand bestand niet, dus anders bleef na
            // "verkeerd nummer" stilletjes de oude audio staan.
            naam: `${t.naam} ${t.id}-${video.videoId}`, type: t.type, jaar: t.jaar, genres: t.genres, taal: t.taal, land: t.land,
            talen: t.talen, media_map: '',
        }, false, { rateLimit: true });
    } catch (err) {
        await pool.query("UPDATE tracks SET werkt = false, review_status = 'afgekeurd' WHERE id = $1", [trackId]);
        throw err;
    }
    // Eén speelbare MP3 per titel: oudere tracks gaan uit (bestanden blijven).
    await pool.query(
        "UPDATE tracks SET werkt = false WHERE titel_id = $1 AND id <> $2 AND werkt = true",
        [t.id, trackId],
    );
    await pool.query(
        `UPDATE titels SET zoek_status = 'gevonden', zoek_melding = NULL, laatste_zoekpoging = now(),
                volgende_poging = NULL WHERE id = $1`,
        [t.id],
    );
    return trackId;
}

// Tijdelijke storingen (blokkade, geen netwerk) en serverproblemen (yt-dlp
// kan YouTube niet uitlezen, ffmpeg ontbreekt) tellen niet als mislukte
// poging en keuren de video níet af: het ligt dan niet aan de video. De
// worker pauzeert en probeert het later opnieuw.
function isBlokkade(err) {
    return /sign in|bot|cookies|\b403\b|\b429\b|too many requests|rate limit|niet bereikbaar|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|javascript runtime|js runtime|requested format is not available|only images are available|signature|nsig|po token|ffmpeg|ffprobe|ENOENT|not found|Errno|unable to extract|HTTP Error 5\d\d/i
        .test(String(err?.stderr || err?.message || ''));
}

// Een downloadfout die echt bij de video hoort (verwijderd, privé,
// leeftijdsgrens, regioblokkade).
function isVideoFout(err) {
    return /video unavailable|private video|has been removed|confirm your age|age-restricted|not available in your country|copyright|members-only|premiere/i
        .test(String(err?.message || ''));
}

/**
 * Zoek en download MP3's voor een batch titels. Geeft terug hoeveel er
 * gelukt zijn en of de AI is aangeroepen.
 */
async function verwerkBatch(titels, signal) {
    const lijst = [];
    let gevonden = 0;
    for (const t of titels) {
        if (lopend.has(t.id)) continue;
        lopend.set(t.id, { sinds: Date.now(), wat: 'zoeken' });
        try {
            if (ytzoek.rateLimitActief()) throw Object.assign(new Error('YouTube-zoeken tijdelijk geblokkeerd'), { blokkade: true });
            const kandidaten = await kandidatenVoor(t);
            if (!kandidaten.length) {
                await markeerMislukt(t, `Geen bruikbare YouTube-resultaten voor "${zoektermen(t)[0] || t.naam}".`);
                lopend.delete(t.id);
                continue;
            }
            lijst.push({ titel: t, kandidaten });
        } catch (err) {
            lopend.delete(t.id);
            if (err.blokkade || isBlokkade(err)) {
                await pool.query("UPDATE titels SET zoek_melding = $2 WHERE id = $1",
                    [t.id, 'YouTube tijdelijk niet bereikbaar; wordt later automatisch opnieuw geprobeerd.']);
                pauzeer();
                for (const l of lijst) lopend.delete(l.titel.id);
                return { gevonden, ai: false, blokkade: true };
            }
            await markeerMislukt(t, `Zoeken mislukt: ${err.message}`);
        }
    }
    if (!lijst.length) return { gevonden, ai: false };

    const keuze = await bankAi.kiesVideo(lijst, signal);
    if (!keuze.ok) {
        for (const l of lijst) lopend.delete(l.titel.id);
        return { gevonden, ai: true, fout: keuze.error };
    }
    for (const { titel: t, kandidaten } of lijst) {
        const k = keuze.items.get(t.id);
        try {
            if (!k || !k.kandidaat) {
                await markeerMislukt(t, `AI vond tussen ${kandidaten.length} YouTube-resultaten geen originele versie${k?.reden ? `: ${k.reden}` : '.'}`);
                continue;
            }
            lopend.set(t.id, { sinds: Date.now(), wat: 'downloaden' });
            await slaOp(t, k.kandidaat, { reden: `AI-keuze: ${k.reden}` });
            gevonden++;
            await bank.log(t.id, 'mp3', `MP3 opgeslagen: ${k.kandidaat.titel}`, { videoId: k.kandidaat.videoId, reden: k.reden });
        } catch (err) {
            if (isBlokkade(err) && !isVideoFout(err)) {
                const reden = String(err.message).replace(/^YouTube lokaal opslaan mislukt:\s*/, '').slice(0, 250);
                await pool.query("UPDATE titels SET zoek_melding = $2 WHERE id = $1",
                    [t.id, `Download lukt tijdelijk niet (${reden}); wordt later automatisch opnieuw geprobeerd.`]);
                await bank.log(t.id, 'fout', `Download tijdelijk mislukt, video niet afgekeurd: ${reden}`);
                pauzeer();
                for (const l of lijst) lopend.delete(l.titel.id);
                return { gevonden, ai: true, blokkade: true };
            }
            // Deze video kon niet; volgende keer een andere kiezen.
            await pool.query(
                "UPDATE titels SET mp3_afgekeurd = array_append(mp3_afgekeurd, $2) WHERE id = $1 AND NOT ($2 = ANY(mp3_afgekeurd))",
                [t.id, k.kandidaat.videoId],
            );
            await markeerMislukt(t, `Download mislukt: ${String(err.message).replace(/^YouTube lokaal opslaan mislukt:\s*/, '').slice(0, 300)}`, { tellen: false });
        } finally {
            lopend.delete(t.id);
        }
    }
    return { gevonden, ai: true };
}

async function haalTitel(id) {
    const { rows } = await pool.query(
        `SELECT id, naam, type::text AS type, jaar, genres, taal::text AS taal, land, talen,
                COALESCE(categorie, type::text) AS categorie, nummer_naam, nummer_artiest,
                yt_zoekterm, mp3_afgekeurd, zoek_pogingen, handmatig
           FROM titels WHERE id = $1`, [id]);
    return rows[0] || null;
}

/** Beheerder plaatst zelf een YouTube-link. Loopt op de achtergrond. */
async function plaatsEigenUrl(titelId, url) {
    const videoId = videoIdUit(url);
    if (!videoId) throw new Error('Geen geldige YouTube-link.');
    const t = await haalTitel(titelId);
    if (!t) throw new Error('Titel niet gevonden.');
    if (lopend.has(t.id)) throw new Error('Er loopt al een download voor deze titel.');
    lopend.set(t.id, { sinds: Date.now(), wat: 'eigen link' });
    await pool.query("UPDATE titels SET zoek_melding = 'Eigen YouTube-link wordt gedownload…' WHERE id = $1", [t.id]);
    (async () => {
        try {
            await slaOp(t, { videoId, titel: 'Eigen YouTube-link' }, { reden: 'Eigen YouTube-link van de beheerder', handmatig: true });
            await pool.query(
                "UPDATE titels SET handmatig = array_append(handmatig, 'mp3') WHERE id = $1 AND NOT ('mp3' = ANY(handmatig))",
                [t.id],
            );
            await bank.log(t.id, 'mp3', `Eigen YouTube-link opgeslagen (${videoId})`);
        } catch (err) {
            await pool.query('UPDATE titels SET zoek_melding = $2 WHERE id = $1',
                [t.id, `Eigen link mislukt: ${String(err.message).slice(0, 300)}`]);
            await bank.log(t.id, 'mp3', `Eigen YouTube-link mislukt: ${err.message}`);
        } finally {
            lopend.delete(t.id);
        }
    })().catch((err) => logger.fout('Eigen link verwerken mislukt', { melding: err.message }));
    return { gestart: true, videoId };
}

/** Huidige MP3 afkeuren en de AI een andere laten zoeken. */
async function keurAf(titelId, reden = 'Afgekeurd door beheerder') {
    const { rows } = await pool.query(
        `UPDATE tracks SET werkt = false, review_status = 'afgekeurd', review_reden = $2
          WHERE titel_id = $1 AND werkt = true RETURNING bron_url, preview_url`,
        [titelId, String(reden).slice(0, 300)],
    );
    const ids = rows.map((r) => videoIdUit(r.bron_url) || videoIdUit(r.preview_url)).filter(Boolean);
    await pool.query(
        `UPDATE titels SET mp3_afgekeurd = (SELECT ARRAY(SELECT DISTINCT unnest(mp3_afgekeurd || $2::text[]))),
                zoek_status = 'nieuw', zoek_pogingen = 0, volgende_poging = NULL,
                zoek_melding = $3, handmatig = array_remove(handmatig, 'mp3')
          WHERE id = $1`,
        [titelId, ids, `${reden}; AI zoekt een andere versie.`],
    );
    await bank.log(titelId, 'mp3', `MP3 afgekeurd: ${reden}`, { videoIds: ids });
    return { afgekeurd: rows.length };
}

async function zoekOpnieuw(titelId) {
    await pool.query(
        `UPDATE titels SET zoek_status = 'nieuw', zoek_pogingen = 0, volgende_poging = NULL,
                zoek_melding = 'Staat in de wachtrij om opnieuw te zoeken.' WHERE id = $1`,
        [titelId],
    );
}

module.exports = {
    verwerkBatch, gepauzeerd, plaatsEigenUrl, keurAf, zoekOpnieuw, isBezig, bezigeIds, videoIdUit, zoektermen,
};
