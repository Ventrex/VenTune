// =====================================================================
// iTunes Search API — gratis, zonder key, zonder account, zonder
// developer mode. Geeft per nummer een 30-seconden preview-clip
// (previewUrl) die je direct in een <audio>-tag afspeelt.
//
// Docs: https://performance-partners.apple.com/search-api
// Endpoint: https://itunes.apple.com/search
// =====================================================================

const logger = require('./logger');

const ZOEK_URL = 'https://itunes.apple.com/search';

// Standaard op de Nederlandse store zodat NL-content beter naar boven komt.
const STANDAARD_LAND = process.env.ITUNES_LAND || 'NL';

/**
 * Zoek nummers op iTunes.
 *
 * @param {string} term    Zoekterm, bv. "Undercover soundtrack".
 * @param {object} [opties] { land, limiet }
 * @returns {Promise<Array>} Lijst met genormaliseerde resultaten.
 */
async function zoek(term, opties = {}) {
    if (!term || !term.trim()) return [];

    const params = new URLSearchParams({
        term: term.trim(),
        media: 'music',
        entity: 'song',
        limit: String(opties.limiet || 10),
        country: opties.land || STANDAARD_LAND,
    });

    const url = `${ZOEK_URL}?${params.toString()}`;

    let resp;
    try {
        resp = await fetch(url, {
            headers: { 'User-Agent': 'VenTune/1.0 (self-hosted quiz)' },
        });
    } catch (err) {
        logger.waarschuwing('iTunes onbereikbaar.', { melding: err.message });
        throw new Error('iTunes is nu niet bereikbaar.');
    }

    if (!resp.ok) {
        throw new Error(`iTunes gaf status ${resp.status}.`);
    }

    const data = await resp.json();
    const resultaten = Array.isArray(data.results) ? data.results : [];

    // Alleen nummers met een echte preview-clip zijn bruikbaar.
    return resultaten
        .filter((r) => r.previewUrl)
        .map((r) => ({
            itunes_track_id: r.trackId,
            tracknaam: r.trackName,
            artiest: r.artistName,
            album: r.collectionName,
            preview_url: r.previewUrl,
            hoes: r.artworkUrl100 || null,
            jaar: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
        }));
}

/**
 * Handige coverage-check: hoeveel bruikbare previews levert een titel op?
 * Gebruikt door het seed-script en de admin/testpagina.
 */
async function dekkingVoor(titel, opties = {}) {
    const resultaten = await zoek(titel, opties);
    return {
        titel,
        aantal: resultaten.length,
        beste: resultaten[0] || null,
        resultaten,
    };
}

module.exports = { zoek, dekkingVoor, STANDAARD_LAND };
