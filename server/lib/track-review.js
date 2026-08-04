// =====================================================================
// Gedeelde kwaliteitsworkflow voor admin en Beta Tester.
//
// Een foute kandidaat wordt niet alleen uitgezet: er wordt maximaal drie keer
// een andere YouTube-video gezocht, lokaal opgeslagen en opnieuw ter review
// aangeboden. Na drie afwijzingen gaat de titel naar de handmatige stapel.
// =====================================================================

const { pool } = require('../db/pool');
const ytzoek = require('./ytzoek');
const { pastBijTitel } = require('./trackcheck');
const { downloadTrack, haalYouTubeStatistieken } = require('../../seed/download-track');
const logger = require('./logger');

const MAX_FOUTE_KANDIDATEN = 3;

function getal(waarde) {
    const n = Number(waarde);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function bekendheidVoor({ views = 0, populariteit = 0, stemmen = 0 } = {}) {
    const v = Number(views) || 0;
    const p = Number(populariteit) || 0;
    const s = Number(stemmen) || 0;
    if (v >= 5000000 || (p >= 4000 && s >= 4000)) return { niveau: 'iconisch', score: 3 };
    if (v >= 1000000 || (p >= 1000 && s >= 1000)) return { niveau: 'heel_bekend', score: 2 };
    if (v >= 250000 || (p >= 200 && s >= 200)) return { niveau: 'bekend', score: 1 };
    return { niveau: 'onbekend', score: 0 };
}

async function werkTitelBekendheid(titelId, executor = pool) {
    const { rows } = await executor.query(
        'SELECT t.populariteit, t.stemmen, ' +
        'COALESCE(MAX(tr.youtube_views), 0)::bigint AS youtube_max_views, ' +
        'COALESCE(MAX(tr.youtube_likes), 0)::bigint AS youtube_max_likes ' +
        'FROM titels t LEFT JOIN tracks tr ON tr.titel_id = t.id ' +
        'WHERE t.id = $1 GROUP BY t.id',
        [titelId],
    );
    const titel = rows[0];
    if (!titel) return null;
    const bekend = bekendheidVoor(titel);
    const { rows: bijgewerkt } = await executor.query(
        'UPDATE titels SET youtube_max_views = $2, youtube_max_likes = $3, ' +
        'youtube_statistieken_op = now(), bekendheidsniveau = $4, bekendheid_score = $5 ' +
        'WHERE id = $1 RETURNING youtube_max_views, youtube_max_likes, bekendheidsniveau, bekendheid_score',
        [
            titelId,
            getal(titel.youtube_max_views) || 0,
            getal(titel.youtube_max_likes) || 0,
            bekend.niveau,
            bekend.score,
        ],
    );
    return bijgewerkt[0] || null;
}

async function slaYoutubeStatistiekenOp(trackId, stats) {
    const views = getal(stats && stats.views);
    const likes = getal(stats && stats.likes);
    const rating = Number.isFinite(Number(stats && stats.rating)) ? Number(stats.rating) : null;
    const duur = getal(stats && stats.duration);
    const { rows } = await pool.query(
        'UPDATE tracks SET youtube_views = COALESCE($2, youtube_views), ' +
        'youtube_likes = COALESCE($3, youtube_likes), youtube_rating = COALESCE($4, youtube_rating), ' +
        'youtube_duur_seconden = COALESCE($5, youtube_duur_seconden), youtube_statistieken_op = now(), ' +
        'youtube_statistieken_melding = NULL WHERE id = $1 RETURNING titel_id',
        [trackId, views, likes, rating, duur],
    );
    if (rows[0]) await werkTitelBekendheid(rows[0].titel_id);
    return rows[0] || null;
}

async function verversYoutubeStatistieken(track, { rateLimit = true } = {}) {
    const stats = await haalYouTubeStatistieken(track, { rateLimit });
    await slaYoutubeStatistiekenOp(track.id, stats);
    return stats;
}

async function verversOntbrekendeYoutubeStatistieken({
    types = ['film', 'serie'],
    onProgress = null,
    isGeannuleerd = () => false,
} = {}) {
    const { rows } = await pool.query(
        'SELECT tr.id, tr.titel_id, tr.bron, tr.preview_url, tr.bron_url ' +
        'FROM tracks tr JOIN titels t ON t.id = tr.titel_id ' +
        'WHERE t.type = ANY($1::text[]) ' +
        'AND (tr.bron_url ILIKE \'%youtube%\' OR (tr.bron = \'youtube\' AND tr.preview_url IS NOT NULL)) ' +
        'AND (tr.youtube_statistieken_op IS NULL OR tr.youtube_statistieken_op < now() - interval \'7 days\') ' +
        'ORDER BY tr.youtube_statistieken_op NULLS FIRST, tr.verificatie_score DESC, tr.id',
        [types],
    );
    let verwerkt = 0;
    let bijgewerkt = 0;
    let mislukt = 0;
    for (const track of rows) {
        if (isGeannuleerd()) return { verwerkt, bijgewerkt, mislukt, geannuleerd: true };
        try {
            await verversYoutubeStatistieken(track, { rateLimit: true });
            bijgewerkt++;
        } catch (err) {
            mislukt++;
            await pool.query(
                'UPDATE tracks SET youtube_statistieken_op = NULL, youtube_statistieken_melding = $2 WHERE id = $1',
                [track.id, String(err.message).slice(0, 500)],
            ).catch(() => {});
        }
        verwerkt++;
        onProgress?.({ verwerkt, totaal: rows.length, bijgewerkt, mislukt, huidige: track.titel_id });
    }
    return { verwerkt, bijgewerkt, mislukt };
}

function videoIdUitBron(waarde) {
    const tekst = String(waarde || '');
    if (/^[A-Za-z0-9_-]{11}$/.test(tekst)) return tekst;
    try {
        const url = new URL(tekst);
        if (url.hostname === 'youtu.be') {
            const id = url.pathname.slice(1);
            return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        const id = url.searchParams.get('v');
        return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch {
        return null;
    }
}

async function uitgeslotenVideos(titelId) {
    const { rows } = await pool.query(
        'SELECT preview_url, bron_url FROM tracks WHERE titel_id = $1',
        [titelId],
    );
    return [...new Set(rows.flatMap((row) => [
        videoIdUitBron(row.preview_url),
        videoIdUitBron(row.bron_url),
    ]).filter(Boolean))];
}

async function maakAlternatief(titel, huidigTrackId) {
    const uitgesloten = await uitgeslotenVideos(titel.id);
    const keuze = await ytzoek.zoekVoorTitel(titel, {
        limiet: 20,
        pauzeMs: 120,
        uitgeslotenVideoIds: uitgesloten,
    });
    if (!keuze) return { gevonden: false, reden: 'Geen andere betrouwbare YouTube-video gevonden.' };

    const bevestigd = Boolean(keuze._viaSong);
    const controle = keuze._controle || pastBijTitel(titel, {
        tracknaam: keuze.titel,
        album: keuze.kanaal,
        bevestigd,
    });
    if (!controle || !controle.past) {
        return { gevonden: false, reden: controle && controle.reden || 'Nieuwe kandidaat niet overtuigend.' };
    }

    const bronUrl = 'https://www.youtube.com/watch?v=' + keuze.videoId;
    const bestaand = await pool.query(
        'SELECT id, bron, preview_url, bron_url, download_status FROM tracks ' +
        'WHERE titel_id = $1 AND (preview_url = $2 OR bron_url = $3) LIMIT 1',
        [titel.id, keuze.videoId, bronUrl],
    );
    let track = bestaand.rows[0];
    if (!track) {
        const { rows } = await pool.query(
            'INSERT INTO tracks ' +
            '(titel_id, bron, preview_url, bron_url, start_seconde, tracknaam, artiest, album, ' +
            ' herkenbaarheid, gecontroleerd, bevestigd, verificatie_score, verificatie_reden, ' +
            ' laatst_gecontroleerd_op, youtube_views, review_status, review_fouten, review_reden) ' +
            'VALUES ($1, \'youtube\', $2, $3, 0, $4, $5, $6, 3, false, $7, $8, $9, now(), $10, \'open\', 0, $11) ' +
            'RETURNING id, bron, preview_url, bron_url, download_status',
            [
                titel.id,
                keuze.videoId,
                bronUrl,
                keuze.titel || 'Intro',
                keuze.kanaal || 'YouTube',
                titel.naam,
                bevestigd,
                controle.zekerheid || 0,
                controle.reden || 'Alternatieve YouTube-kandidaat',
                getal(keuze.views),
                'Alternatief na afkeuring van track ' + huidigTrackId,
            ],
        );
        track = rows[0];
    }

    try {
        await downloadTrack({ ...track, naam: titel.naam, type: titel.type }, false, { rateLimit: true });
    } catch (err) {
        logger.waarschuwing('Alternatieve track kon niet lokaal worden opgeslagen.', {
            titel: titel.naam,
            melding: err.message,
        });
        return { gevonden: true, gedownload: false, track_id: track.id, reden: err.message };
    }

    const { rows: lokaal } = await pool.query('SELECT * FROM tracks WHERE id = $1', [track.id]);
    return { gevonden: true, gedownload: true, track: lokaal[0] || null };
}

async function haalReviewVolgende({ types = ['film', 'serie'] } = {}) {
    const veiligeTypes = Array.isArray(types) && types.length
        ? types.filter((type) => ['film', 'serie', 'muziek'].includes(type))
        : ['film', 'serie'];
    const { rows } = await pool.query(
        'SELECT tr.id, tr.titel_id, tr.bron, tr.preview_url, tr.bron_url, tr.bestand_pad, ' +
        'tr.tracknaam, tr.artiest, tr.album, tr.verificatie_score, tr.verificatie_reden, ' +
        'tr.review_status, tr.review_fouten, tr.review_reden, tr.gecontroleerd, tr.youtube_views, ' +
        'tr.youtube_likes, tr.youtube_rating, tr.youtube_duur_seconden, tr.download_status, ' +
        't.naam AS titel_naam, t.type AS titel_type, t.taal AS titel_taal, t.jaar AS titel_jaar, ' +
        't.genres AS titel_genres, t.youtube_max_views, t.youtube_max_likes, t.bekendheidsniveau, ' +
        't.tmdb_score, t.populariteit, t.stemmen ' +
        'FROM tracks tr JOIN titels t ON t.id = tr.titel_id ' +
        'WHERE t.type = ANY($1::text[]) AND tr.bron = \'lokaal\' AND tr.download_status = \'available\' ' +
        'AND tr.werkt = true AND COALESCE(tr.review_status, \'open\') = \'open\' ' +
        'AND COALESCE(tr.review_fouten, 0) < $2 ' +
        'ORDER BY FLOOR(COALESCE(tr.verificatie_score, 0) * 20) DESC, random() LIMIT 1',
        [veiligeTypes, MAX_FOUTE_KANDIDATEN],
    );
    const { rows: telling } = await pool.query(
        'SELECT COUNT(*) FILTER (WHERE tr.review_status = \'open\' AND tr.werkt = true ' +
        'AND tr.bron = \'lokaal\' AND tr.download_status = \'available\')::int AS open, ' +
        'COUNT(*) FILTER (WHERE tr.review_status = \'handmatig\')::int AS handmatig, ' +
        'COUNT(*) FILTER (WHERE tr.review_status = \'goedgekeurd\')::int AS goedgekeurd ' +
        'FROM tracks tr JOIN titels t ON t.id = tr.titel_id WHERE t.type = ANY($1::text[])',
        [veiligeTypes],
    );
    return {
        track: rows[0] || null,
        telling: telling[0] || { open: 0, handmatig: 0, goedgekeurd: 0 },
    };
}

async function beoordeelTrack(trackId, beoordeling, toelichting = null, { actor = 'admin' } = {}) {
    const goed = beoordeling === 'goed';
    const fout = beoordeling === 'fout';
    if (!goed && !fout) throw new Error('Beoordeling moet goed of fout zijn.');

    const { rows } = await pool.query(
        'SELECT tr.*, t.id AS titel_id, t.naam AS titel_naam, t.type AS titel_type, ' +
        't.aliassen, t.taal, t.jaar, t.land, t.genres FROM tracks tr ' +
        'JOIN titels t ON t.id = tr.titel_id WHERE tr.id = $1 FOR UPDATE',
        [trackId],
    );
    const track = rows[0];
    if (!track) throw new Error('Track niet gevonden.');
    const titel = {
        id: track.titel_id,
        naam: track.titel_naam,
        type: track.titel_type,
        aliassen: track.aliassen || [],
        taal: track.taal,
        jaar: track.jaar,
        land: track.land,
        genres: track.genres || [],
    };

    if (goed) {
        const { rows: goedRows } = await pool.query(
            'UPDATE tracks SET review_status = \'goedgekeurd\', review_handmatig = true, ' +
            'review_fouten = 0, review_laatste_op = now(), review_reden = $2, gecontroleerd = true, ' +
            'bevestigd = true, werkt = true, fout_aantal = 0, verificatie_score = 1, ' +
            'verificatie_reden = \'handmatig goedgekeurd via trackcontrole\', ' +
            'laatst_gecontroleerd_op = now() WHERE id = $1 RETURNING *',
            [trackId, 'Goedgekeurd door ' + actor + '.' + (toelichting ? ' ' + String(toelichting).slice(0, 400) : '')],
        );
        return { beoordeling: 'goed', track: goedRows[0] || null };
    }

    const { rows: foutRows } = await pool.query(
        'UPDATE tracks SET review_fouten = COALESCE(review_fouten, 0) + 1, review_laatste_op = now(), ' +
        'review_reden = $2, review_status = CASE WHEN COALESCE(review_fouten, 0) + 1 >= $3 ' +
        'THEN \'handmatig\' ELSE \'afgekeurd\' END, werkt = false, gecontroleerd = false, ' +
        'bevestigd = false, fout_aantal = COALESCE(fout_aantal, 0) + 1 WHERE id = $1 RETURNING *',
        [
            trackId,
            'Afgekeurd door ' + actor + '.' + (toelichting ? ' ' + String(toelichting).slice(0, 400) : ''),
            MAX_FOUTE_KANDIDATEN,
        ],
    );
    const afgekeurd = foutRows[0];
    await pool.query(
        'INSERT INTO meldingen (track_id, titel_id, soort, toelichting) VALUES ($1, $2, \'verkeerd_nummer\', $3)',
        [
            trackId,
            track.titel_id,
            toelichting ? String(toelichting).slice(0, 500) : 'Track afgekeurd tijdens ' + actor + '-controle.',
        ],
    );

    const poging = Number(afgekeurd.review_fouten) || 1;
    if (poging >= MAX_FOUTE_KANDIDATEN) {
        return {
            beoordeling: 'fout',
            poging,
            handmatig: true,
            alternatief: null,
            melding: 'Drie kandidaten afgekeurd; deze titel staat nu op de handmatige stapel.',
        };
    }

    let alternatief;
    try {
        alternatief = await maakAlternatief(titel, trackId);
    } catch (err) {
        logger.waarschuwing('Alternatieve YouTube-track zoeken mislukt.', {
            titel: titel.naam,
            melding: err.message,
        });
        alternatief = { gevonden: false, reden: err.message };
    }
    return {
        beoordeling: 'fout',
        poging,
        handmatig: false,
        alternatief,
        melding: alternatief && alternatief.gedownload
            ? 'Nieuwe kandidaat gedownload en teruggezet in Trackcontrole.'
            : 'Geen lokaal alternatief klaar: ' + (alternatief && alternatief.reden || 'probeer later opnieuw'),
    };
}

module.exports = {
    MAX_FOUTE_KANDIDATEN,
    bekendheidVoor,
    werkTitelBekendheid,
    slaYoutubeStatistiekenOp,
    verversYoutubeStatistieken,
    verversOntbrekendeYoutubeStatistieken,
    haalReviewVolgende,
    beoordeelTrack,
};
