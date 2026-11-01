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
const codex = require('./codex');
const { mediaWebpad } = require('./media-naming');
const { pool } = require('../db/pool');
const logger = require('./logger');

const execFileAsync = promisify(execFile);

const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
// Bewaar complete audio; kies het quiz-startpunt later via tracks.start_seconde.
const MAX_BYTES = 35 * 1024 * 1024;

/**
 * Zoek een voorbeeld-video voor een aanbeveling.
 * @returns {Promise<{videoId:string, titel:string, duurSeconden:number}|null>}
 */
// Eén AI-onderzoek per titel, gecachet in de aanbeveling. Geen herhaalde
// tokenverbranding bij een YouTube-fout of wanneer hetzelfde nummer terugkomt.
const aiOnderzocht = new Set();
async function bepaalHerkenningsmuziek(a) {
    if (!['film','serie'].includes(a.type) || (a.tracknaam && a.tracknaam.trim())) return a;
    if (aiOnderzocht.has(a.id)) return a;
    aiOnderzocht.add(a.id);
    const schema={type:'object',additionalProperties:false,required:['gevonden','nummer','artiest','zoekterm'],properties:{
      gevonden:{type:'boolean'},nummer:{type:'string'},artiest:{type:'string'},zoekterm:{type:'string'}}};
    try {
        const r=await codex.vraagJson({schema,prompt:
          'Bepaal de ECHTE herkenbare openingstitel, intro of officiële hoofdthema-muziek van '+a.type+' "'+a.titel+'" ('+(a.jaar||'jaar onbekend')+'). '+
          'Geef alleen een specifiek, verifieerbaar muziekstuk en uitvoerende artiest/componist. '+
          'Als de juiste muziek onbekend is: gevonden=false en lege strings. '+
          'Geen gok, geen willekeurig soundtracknummer. Een korte specifieke YouTube-zoekterm. JSON volgens schema.'});
        const d=r.data;
        if(r.ok && d?.gevonden && d.nummer?.trim() && d.zoekterm?.trim()){
            const info={...a,tracknaam:d.nummer.trim().slice(0,180),artiest:(d.artiest||'').trim().slice(0,180),
               youtube_zoekterm:d.zoekterm.trim().slice(0,320)};
            await pool.query('UPDATE aanbevelingen SET tracknaam=$2,artiest=$3,youtube_zoekterm=$4 WHERE id=$1',
              [a.id,info.tracknaam,info.artiest,info.youtube_zoekterm]);
            return info;
        }
        logger.waarschuwing('AI herkent geen betrouwbare titelmuziek',{id:a.id,titel:a.titel,melding:r.error||'onzeker'});
    }catch(e){logger.waarschuwing('AI-muziekonderzoek mislukt',{id:a.id,melding:e.message});}
    return a;
}
function gelijktOpTitel(video, a){
    const norm=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
    const naam=norm(a.titel), naamVideo=norm(video.titel);
    if(!naam || !naamVideo)return false;
    // Geen generieke zoekresultaten accepteren waar de titel niet in staat.
    const exact=naamVideo.includes(naam);
    const matchTrack=a.tracknaam && a.tracknaam.trim().length>=5 && naamVideo.includes(norm(a.tracknaam))
       && /theme|opening|intro|ost|soundtrack|main title|score/i.test(video.titel);
    const fouteType=/trailer|reaction|review|recap|explained|gameplay|fan edit|cover|tutorial|remix/i.test(video.titel);
    return !fouteType && (exact || matchTrack)
       && /theme|opening|intro|title|song|soundtrack|score|music|tune|ost/i.test(video.titel);
}
async function zoekVoorbeeld(aanbeveling) {
    const a=await bepaalHerkenningsmuziek(aanbeveling);
    const titel=String(a.titel||'').trim(),track=String(a.tracknaam||'').trim();
    const isSerie=a.type==='serie'||a.categorie==='serie';
    const termen=[...new Set([
        track? `"${titel}" "${track}" theme`:'',
        a.youtube_zoekterm,
        `"${titel}" ${isSerie?'TV series opening theme':'movie main theme soundtrack'}`
    ].filter(Boolean))];
    const afgekeurd=new Set(a.afgekeurde_bronnen||[]);
    for(const term of termen.slice(0,3)){
        try{
            const resultaten=await ytzoek.zoek(term,{limiet:8});
            const beste=(resultaten||[]).find(r=>r.videoId&&!afgekeurd.has(r.videoId)
              && ytzoek.isLatijnsSchrift(r.titel)
              && (!r.duurSeconden || r.duurSeconden<10*60) && gelijktOpTitel(r,a));
            if(beste)return {videoId:beste.videoId,titel:beste.titel,duurSeconden:beste.duurSeconden||0};
        }catch(e){logger.waarschuwing('Zoeken titelmuziek mislukt',{term,melding:e.message});}
    }
    throw new Error('Geen voldoende betrouwbare YouTube-match gevonden voor '+titel+'. Titel blijft in wachtrij; geen willekeurige soundtrack downloaden.');
}

// Download alleen bij het opvragen van een luistervoorbeeld. Hergebruik het
// bestand bij opnieuw openen; zo hoeft de browser geen YouTube-iframe te laden.
const previewDownloads = new Map();
let audioInfrastructuurFout = null;
let audioInfrastructuurTot = 0;
function infrastructuurStoring() { return Date.now() < audioInfrastructuurTot ? audioInfrastructuurFout : null; }
async function lokaalVoorbeeld(aanbeveling) {
    const id = Number(aanbeveling?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ongeldige aanbeveling.');
    const naam = `aanbeveling-${id}.mp3`;
    const map = path.join(MEDIA_DIR, 'previews');
    const bestand = path.join(map, naam);
    // Alleen bestanden met marker zijn volgens het nieuwe volledige-audioformaat gemaakt.
    const marker = bestand + '.volledig';
    const url = `/media/previews/${naam}`;
    const bestaand = async () => {
        try {
            const stat = await fs.stat(bestand);
            await fs.access(marker);
            return stat.size > 0 && stat.size <= MAX_BYTES;
        } catch { return false; }
    };
    if (await bestaand()) {
        const stat = await fs.stat(bestand);
        return { audioUrl: `${url}?v=${Math.floor(stat.mtimeMs)}` };
    }
    if (previewDownloads.has(id)) return previewDownloads.get(id);
    if (infrastructuurStoring() || ytzoek.rateLimitActief()) throw new Error('YouTube rate limit: luisterfragmenten tijdelijk gepauzeerd.');
    const taak = (async () => {
        await fs.mkdir(map, { recursive: true });
        const afgekeurd = new Set(aanbeveling.afgekeurde_bronnen || []);
        let laatsteFout = '';
        // Bij een verwijderde/onbeschikbare video automatisch een volgende bron kiezen.
        for (let poging = 0; poging < 5; poging++) {
            const bron = await zoekVoorbeeld({ ...aanbeveling, afgekeurde_bronnen: [...afgekeurd] });
            if (!bron) break;
            const tmpBasis = path.join(map, `aanbeveling-${id}-${Date.now()}-${poging}`);
            const tmp = `${tmpBasis}.mp3`;
            try {
                await execFileAsync('yt-dlp', [
                    '--js-runtimes', 'node',
                    '--no-playlist', '--extract-audio',
                    '--audio-format', 'mp3', '--audio-quality', '5',
                    '--no-part', '--output', `${tmpBasis}.%(ext)s`,
                    `https://www.youtube.com/watch?v=${bron.videoId}`,
                ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
                const stat = await fs.stat(tmp);
                if (stat.size < 1 || stat.size > MAX_BYTES) throw new Error('Luistervoorbeeld is leeg of te groot.');
                await fs.rename(tmp, bestand);
                await fs.writeFile(marker, 'volledige-audio-v1');
                await pool.query('UPDATE aanbevelingen SET voorbeeld_bron = $2 WHERE id = $1', [id, bron.videoId]);
                return { audioUrl: `${url}?v=${Math.floor((await fs.stat(bestand)).mtimeMs)}` };
            } catch (err) {
                laatsteFout = (err.stderr && err.stderr.trim() ? err.stderr.slice(-900) : err.message);
                // Serverbrede storingen (YouTube-blokkade, ffmpeg/yt-dlp ontbreekt)
                // maken de VIDEO niet fout. Bewaar de bron voor later herstel.
                if (/sign in|bot|cookies|HTTP Error 403|HTTP Error 429|too many requests|ffmpeg.*not found|ENOENT|no such file or directory/i.test(laatsteFout)) {
                    if (/HTTP Error 429|too many requests/i.test(laatsteFout)) ytzoek.markeerRateLimit(429);
                    audioInfrastructuurFout = laatsteFout.slice(0, 350);
                    audioInfrastructuurTot = Date.now() + (/HTTP Error 429|too many requests/i.test(laatsteFout) ? 15 * 60 * 1000 : 30 * 60 * 1000);
                    throw new Error('Downloadservice niet beschikbaar: ' + audioInfrastructuurFout);
                }
                afgekeurd.add(bron.videoId);
                logger.waarschuwing('Videobron niet downloadbaar', { id, videoId: bron.videoId, melding: laatsteFout.slice(0, 250) });
                await pool.query(
                    'UPDATE aanbevelingen SET afgekeurde_bronnen = array_append(afgekeurde_bronnen, $2) WHERE id = $1 AND NOT ($2 = ANY(afgekeurde_bronnen))',
                    [id, bron.videoId]);
            } finally {
                await fs.rm(tmp, { force: true }).catch(() => {});
            }
        }
        throw new Error('Geen van de beschikbare videobronnen kon worden gedownload. ' + (laatsteFout || 'YouTube-zoekfunctie heeft geen geschikte video opgeleverd.').slice(0, 500));
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
    await fs.rm(path.join(MEDIA_DIR, 'previews', `aanbeveling-${id}.mp3.volledig`), { force: true });
}

// Alleen echte albumhoezen uit de iTunes-catalogus, niet gegenereerde covers.
async function zoekMuziekCover(tracknaam, artiest) {
    if (!tracknaam || !artiest) return null;
    const params = new URLSearchParams({ term: `${tracknaam} ${artiest}`, entity: 'song', limit: '12', country: 'nl' });
    const resp = await fetch(`https://itunes.apple.com/search?${params.toString()}`, {
        signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const norm = (v) => String(v || '').normalize('NFKC').toLowerCase().trim();
    const resultaat = (data.results || []).find((x) =>
        norm(x.trackName) === norm(tracknaam) && norm(x.artistName) === norm(artiest));
    return resultaat?.artworkUrl100?.replace(/100x100bb/, '600x600bb') || null;
}

/** Vind of maak de titel die bij een aanbeveling hoort. */
async function vindOfMaakTitel(a) {
    if (a.categorie === 'games') {
        const {rows: bestaande}=await pool.query(
            "SELECT id FROM titels WHERE lower(naam)=lower($1) AND type='muziek' LIMIT 1",[a.titel]);
        if(bestaande[0]){
            await pool.query(`UPDATE titels SET
                genres=CASE WHEN 'Videogames'=ANY(genres) THEN genres ELSE array_append(genres,'Videogames') END,
                muziek_genres=CASE WHEN 'Videogames'=ANY(muziek_genres) THEN muziek_genres ELSE array_append(muziek_genres,'Videogames') END
                WHERE id=$1`,[bestaande[0].id]);
            return bestaande[0].id;
        }
        const {rows}=await pool.query(`
            INSERT INTO titels(naam,type,taal,jaar,genres,muziek_genres,themas,curatie_status)
            VALUES($1,'muziek','en',$2,ARRAY['Videogames'],ARRAY['Videogames'],ARRAY['games'],'goedgekeurd')
            RETURNING id`,[a.titel,a.jaar]);
        return rows[0].id;
    }
    if (a.soort !== 'film_serie') {
        // Een kerstnummer is zelf de te raden titel (type 'muziek').
        const naam = a.tracknaam;
        const { rows: best } = await pool.query(
            `SELECT id FROM titels WHERE lower(naam) = lower($1) AND type = 'muziek' LIMIT 1`, [naam]);
        if (best[0]) return best[0].id;
        const { rows } = await pool.query(
            `INSERT INTO titels (naam, type, jaar, genres, taal, themas, muziek_genres)
             VALUES ($1, 'muziek', $2, $3, 'nl', $4, $5)
             RETURNING id`,
            [naam, Number.isFinite(a.jaar) ? a.jaar : null,
             a.categorie === 'kerst' ? ['Kerst'] : Array.isArray(a.muziek_genres) ? a.muziek_genres : [],
             [a.categorie], Array.isArray(a.muziek_genres) ? a.muziek_genres : []]);
        return rows[0].id;
    }
    // film/serie
    const type = a.type === 'serie' ? 'serie' : 'film';
    const { rows: best } = await pool.query(
        `SELECT id FROM titels WHERE lower(naam) = lower($1) AND type = $2 LIMIT 1`, [a.titel, type]);
    if (best[0]) return best[0].id;
    const { rows } = await pool.query(
        `INSERT INTO titels (naam, type, jaar, genres, taal, themas, studio, muziek_genres, omschrijving)
         VALUES ($1, $2, $3, $4, 'en', $5, $6, $7, $8) RETURNING id`,
        [a.titel, type, Number.isFinite(a.jaar) ? a.jaar : null,
         Array.isArray(a.genres) ? a.genres : [],
          Array.isArray(a.themas) ? a.themas : [], a.studio || null,
          Array.isArray(a.muziek_genres) ? a.muziek_genres : [], a.omschrijving || null]);
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
    let titelRij = (await pool.query('SELECT * FROM titels WHERE id = $1', [titelId])).rows[0];
    // Posters zijn afkomstig van TMDB, nooit door AI verzonnen.
    if (a.soort === 'film_serie' && !titelRij.poster_pad) {
        try {
            const info = await require('./tmdb').zoekPresentatie(a.titel, a.type, a.jaar);
            if (info) {
                const { rows: bijgewerkt } = await pool.query(
                    `UPDATE titels SET tmdb_id = COALESCE(tmdb_id, $2),
                         poster_pad = COALESCE(poster_pad, $3),
                         omschrijving = COALESCE(NULLIF(omschrijving, ''), $4)
                     WHERE id = $1 RETURNING *`,
                    [titelId, info.tmdbId, info.posterPad, info.omschrijving]);
                titelRij = bijgewerkt[0] || titelRij;
            }
        } catch (err) {
            logger.waarschuwing('TMDB-poster ophalen mislukt', { titelId, melding: err.message });
        }
    }

    if (a.soort !== 'film_serie' && !titelRij.cover_url) {
        try {
            const cover = await zoekMuziekCover(a.tracknaam, a.artiest);
            if (cover) await pool.query('UPDATE titels SET cover_url = $2 WHERE id = $1', [titelId, cover]);
        } catch (err) {
            logger.waarschuwing('Muziekhoes ophalen overgeslagen', { titelId, melding: err.message });
        }
    }

    // 3. Downloadpad bepalen (zelfde conventie als de gewone import).
    const media = mediaWebpad(MEDIA_DIR, titelRij, '', '.mp3', `aanb${a.id}`);
    await fs.mkdir(media.basis, { recursive: true });
    const bronUrl = voorbeeld?.videoId ? `https://www.youtube.com/watch?v=${voorbeeld.videoId}` : null;

    // 4. Geen tweede download als het luistervoorbeeld al klaarstaat.
    try {
        if (voorbereid) {
            await fs.copyFile(path.join(MEDIA_DIR, 'previews', `aanbeveling-${a.id}.mp3`), media.bestand);
        } else await execFileAsync('yt-dlp', [
            '--js-runtimes', 'node',
            '--no-playlist',
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

// Herstel goedgekeurde nummers die vroeger als 45-secondenfragment zijn bewaard.
// Sla de nieuwe audio eerst tijdelijk op en vervang pas na een geslaagde download.
async function herstelGoedgekeurdeAudio({ voortgang } = {}) {
    const { absoluutPad } = require('./media-files');
    const { rows } = await pool.query(`
        SELECT DISTINCT ON (tr.id) tr.id, tr.bestand_pad, tr.bron_url
        FROM tracks tr
        JOIN aanbevelingen a ON a.titel_id = tr.titel_id
        WHERE a.status = 'toegevoegd'
          AND tr.bron = 'lokaal'
          AND tr.bron_url LIKE 'https://www.youtube.com/watch?v=%'
          AND tr.bestand_pad IS NOT NULL
        ORDER BY tr.id, a.aangemaakt_op DESC`);
    const resultaat = { totaal: rows.length, verwerkt: 0, hersteld: 0, mislukt: 0, fouten: [] };
    for (const tr of rows) {
        const doel = absoluutPad(tr.bestand_pad);
        if (!doel) {
            resultaat.mislukt++;
        } else {
            const tijdelijk = doel.replace(/\.mp3$/i, '') + '.herstel-' + tr.id + '.mp3';
            try {
                await fs.mkdir(path.dirname(doel), { recursive: true });
                await execFileAsync('yt-dlp', [
                    '--js-runtimes', 'node', '--no-playlist',
                    '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5',
                    '--no-part', '--output', tijdelijk, tr.bron_url,
                ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
                const info = await fs.stat(tijdelijk);
                if (info.size < 1 || info.size > MAX_BYTES) throw new Error('Download heeft ongeldige grootte.');
                await fs.rename(tijdelijk, doel);
                await pool.query(
                    "UPDATE tracks SET gedownload_op = now(), download_status = 'available', werkt = true WHERE id = $1",
                    [tr.id]);
                resultaat.hersteld++;
            } catch (err) {
                resultaat.mislukt++;
                if (resultaat.fouten.length < 10) resultaat.fouten.push({ id: tr.id, fout: String(err.message).slice(0, 180) });
            } finally {
                await fs.rm(tijdelijk, { force: true }).catch(() => {});
            }
        }
        resultaat.verwerkt++;
        if (voortgang) voortgang({ ...resultaat });
    }
    return resultaat;
}

module.exports = { zoekVoorbeeld, lokaalVoorbeeld, keurMp3Af, verwerkGoed, herstelGoedgekeurdeAudio, rateLimitTot: () => audioInfrastructuurTot > Date.now() ? audioInfrastructuurTot : 0 };
