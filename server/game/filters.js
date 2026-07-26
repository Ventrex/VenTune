// =====================================================================
// Filter-helper: vertaalt de gekozen filters (categorie, taal, periode)
// naar SQL-condities. Wordt gebruikt door de telling-endpoint én later
// door de game-engine bij het kiezen van rondes, zodat de logica op één
// plek staat.
// =====================================================================

/**
 * Bouw WHERE-condities voor een query op titels (alias 't').
 *
 * @param {object} f  { categorie, taal, collectie, collecties, periode_start, periode_eind,
 *                      min_bekendheid, zonder_genres, leeftijd_max,
 *                      alleen_nl_tv }
 * @returns {{ where: string, params: any[] }}
 */
function bouwFilter(f = {}) {
    const condities = [];
    const params = [];

    // Inhoudstype: films | series | muziek | beide. Collecties zijn aparte
    // labels; Frozen kan dus film + Disney zijn zonder dat het filmtype
    // verloren gaat.
    if (f.categorie === 'films') {
        params.push('film');
        condities.push(`t.type = $${params.length}`);
    } else if (f.categorie === 'series') {
        params.push('serie');
        condities.push(`t.type = $${params.length}`);
    } else if (f.categorie === 'muziek') {
        params.push('muziek');
        condities.push(`t.type = $${params.length}`);
    } else if (f.categorie === 'beide' || !f.categorie) {
        condities.push(`t.type IN ('film', 'serie')`);
    }

    const gekozenCollecties = Array.isArray(f.collecties) && f.collecties.length
        ? f.collecties
        : (f.collectie && f.collectie !== 'alles' ? [f.collectie] : []);
    const collecties = gekozenCollecties
        .map((waarde) => String(waarde).trim().toLowerCase())
        .filter((waarde) => /^[a-z0-9][a-z0-9-]*$/.test(waarde));
    if (collecties.length) {
        params.push([...new Set(collecties)]);
        condities.push(
            `EXISTS (SELECT 1 FROM titel_collecties tc
                      JOIN collecties c ON c.id = tc.collectie_id
                     WHERE tc.titel_id = t.id
                       AND c.actief = true
                       AND c.sleutel = ANY($${params.length}::text[]))`,
        );
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
    const start = Number.isFinite(f.periode_start) ? f.periode_start : 1930;
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

    // De standaard spelcatalogus is gecureerd voor titels die in Nederland
    // op televisie of breed via de Nederlandse zenders te zien waren. Nieuwe
    // TMDB-imports blijven eerst buiten het spel tot de admin ze beoordeelt.
    if (f.alleen_nl_tv !== false) {
        condities.push(`t.nl_tv_bekend = true AND t.curatie_status = 'goedgekeurd'`);
    }

    // Een leeftijdsfilter is optioneel. Onbekende/ongeclassificeerde titels
    // staan op 16 en vallen dus bewust buiten een kindvriendelijke selectie.
    const leeftijd = Number(f.leeftijd_max);
    if (Number.isFinite(leeftijd) && leeftijd > 0) {
        params.push(leeftijd);
        condities.push(`t.leeftijdsgrens <= $${params.length}`);
    }

    const where = condities.length ? `WHERE ${condities.join(' AND ')}` : '';
    return { where, params };
}

module.exports = { bouwFilter };
