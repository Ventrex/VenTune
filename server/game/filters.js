// =====================================================================
// Filter-helper: vertaalt de gekozen filters (categorie, taal, periode)
// naar SQL-condities. Wordt gebruikt door de telling-endpoint én later
// door de game-engine bij het kiezen van rondes, zodat de logica op één
// plek staat.
// =====================================================================

/**
 * Bouw WHERE-condities voor een query op titels (alias 't').
 *
 * @param {object} f  { categorie, taal, periode_start, periode_eind }
 * @returns {{ where: string, params: any[] }}
 */
function bouwFilter(f = {}) {
    const condities = [];
    const params = [];

    // Categorie: films | series | beide
    if (f.categorie === 'films') {
        params.push('film');
        condities.push(`t.type = $${params.length}`);
    } else if (f.categorie === 'series') {
        params.push('serie');
        condities.push(`t.type = $${params.length}`);
    }

    // Taal: nl | en | beide
    if (f.taal === 'nl') {
        params.push('nl');
        condities.push(`t.taal = $${params.length}`);
    } else if (f.taal === 'en') {
        params.push('en');
        condities.push(`t.taal = $${params.length}`);
    }

    // Periode: jaar binnen [start, eind]. Titels zonder jaar vallen buiten
    // een beperkte periode maar tellen mee bij de volledige reeks.
    const start = Number.isFinite(f.periode_start) ? f.periode_start : 1950;
    const eind = Number.isFinite(f.periode_eind) ? f.periode_eind : 2100;
    params.push(start);
    const iStart = params.length;
    params.push(eind);
    const iEind = params.length;
    condities.push(`t.jaar IS NOT NULL AND t.jaar BETWEEN $${iStart} AND $${iEind}`);

    // Bekendheid: alleen titels die genoeg mensen kennen. 'stemmen' uit TMDB
    // is hiervoor de betrouwbaarste maat. Titels zonder TMDB-gegevens (zoals
    // handmatig of via playlists toegevoegde) blijven altijd meedoen.
    const drempel = Number(f.min_bekendheid);
    if (Number.isFinite(drempel) && drempel > 0) {
        params.push(drempel);
        condities.push(
            `(t.stemmen >= $${params.length} OR t.tmdb_id IS NULL)`,
        );
    }

    // Genres uitsluiten (bijvoorbeeld geen horror). Leeg = alles toegestaan.
    if (Array.isArray(f.zonder_genres) && f.zonder_genres.length > 0) {
        params.push(f.zonder_genres);
        condities.push(`NOT (t.genres && $${params.length}::text[])`);
    }

    const where = condities.length ? `WHERE ${condities.join(' AND ')}` : '';
    return { where, params };
}

module.exports = { bouwFilter };
