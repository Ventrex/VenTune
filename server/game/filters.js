// =====================================================================
// Filter-helper: vertaalt de gekozen filters (categorie, taal, periode)
// naar SQL-condities. Wordt gebruikt door de telling-endpoint én later
// door de game-engine bij het kiezen van rondes, zodat de logica op één
// plek staat.
// =====================================================================

/**
 * Bouw WHERE-condities voor een query op titels (alias 't').
 *
 * @param {object} f  { categorie, categorieen, taal, collectie, collecties, periode_start, periode_eind,
 *                      min_bekendheid, zonder_genres, leeftijd_max,
 *                      alleen_nl_tv, alleen_gecontroleerd, alleen_lokaal }
 * @returns {{ where: string, params: any[] }}
 */
function bouwFilter(f = {}) {
    const condities = [];
    const params = [];

    // Inhoudstype: films | series | muziek | beide. Collecties zijn aparte
    // labels; Frozen kan dus film + Disney zijn zonder dat het filmtype
    // verloren gaat.
    const categorieen = Array.isArray(f.categorieen)
        ? f.categorieen.filter((type) => ['film', 'serie', 'muziek'].includes(type))
        : [];
    if (categorieen.length) {
        params.push([...new Set(categorieen)]);
        // `type` is a PostgreSQL enum. Cast it to text before comparing with
        // the text array from the URL; otherwise PostgreSQL rejects the
        // telling query with "operator does not exist: titel_type = text".
        condities.push(`t.type::text = ANY($${params.length}::text[])`);
    } else if (f.categorie === 'films') {
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

    // Taal: nl | en | us | beide. `us` gebruikt land, omdat Amerikaans
    // geen aparte gesproken-taalwaarde is in de catalogus.
    if (f.taal === 'nl') {
        params.push('nl');
        condities.push(`t.taal = $${params.length}`);
    } else if (f.taal === 'us') {
        params.push('VS');
        condities.push(`t.land = $${params.length}`);
    } else if (f.taal === 'en') {
        params.push('en');
        condities.push(`t.taal = $${params.length}`);
    }

    // Periode: jaar binnen [start, eind]. Titels zonder jaar vallen buiten
    // een beperkte periode maar tellen mee bij de volledige reeks.
    const startGetal = Number(f.periode_start);
    const eindGetal = Number(f.periode_eind);
    const start = Number.isFinite(startGetal) ? startGetal : 1930;
    const eind = Number.isFinite(eindGetal) ? eindGetal : 2100;
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

    // Genres eisen: de basis onder de Comedy-, Actie- en Tekenfilm-quiz.
    // TMDB levert genres soms in het Nederlands en soms in het Engels, dus
    // beide schrijfwijzen worden meegegeven.
    if (Array.isArray(f.met_genres) && f.met_genres.length > 0) {
        params.push(f.met_genres);
        condities.push(`t.genres && $${params.length}::text[]`);
    }

    // Studio's, voor een editie rond één maker (Disney, Pixar, Ghibli).
    // Collecties blijven leidend; dit is de aanvulling voor titels die nog
    // niet handmatig in een collectie zijn gezet.
    if (Array.isArray(f.studios) && f.studios.length > 0) {
        params.push(f.studios.map((s) => String(s).toLowerCase()));
        condities.push(`lower(COALESCE(t.studio, '')) = ANY($${params.length}::text[])`);
    }

    // De standaard spelcatalogus is gecureerd voor titels die in Nederland
    // op televisie of breed via de Nederlandse zenders te zien waren. Nieuwe
    // TMDB-imports blijven eerst buiten het spel tot de admin ze beoordeelt.
    if (f.alleen_nl_tv !== false) {
        condities.push(`t.nl_tv_bekend = true AND t.curatie_status = 'goedgekeurd'`);
    }

    // Kindmodus is een echte inhoudsfilter, niet alleen een scorebonus:
    // maximaal 12+, alleen familie/animatie/fantasy/musical/avontuur/komedie/
    // sciencefiction of een expliciete
    // kindercollectie. Zo blijven volwassen drama's en actiefilms buiten de
    // kindereditie, ook als hun leeftijdsgrens toevallig laag staat.
    if (f.kindvriendelijk === true) {
        params.push(['Animatie', 'Animation', 'Familie', 'Family', 'Fantasy', 'Musical', 'Avontuur', 'Adventure', 'Komedie', 'Comedy', 'Sciencefiction', 'Science Fiction']);
        const genreParam = params.length;
        condities.push(
            `(t.leeftijdsgrens <= 12 AND
              (t.genres && $${genreParam}::text[] OR EXISTS (
                  SELECT 1 FROM titel_collecties tc
                  JOIN collecties c ON c.id = tc.collectie_id
                 WHERE tc.titel_id = t.id
                   AND c.actief = true
                   AND c.sleutel IN ('kids', 'disney', 'pixar')
              )))`,
        );
    }

    // Een leeftijdsfilter is optioneel. Onbekende/ongeclassificeerde titels
    // staan op 16 en vallen dus bewust buiten een kindvriendelijke selectie.
    const leeftijd = Number(f.leeftijd_max);
    if (Number.isFinite(leeftijd) && leeftijd > 0) {
        params.push(leeftijd);
        condities.push(`t.leeftijdsgrens <= $${params.length}`);
    }

    // Quizavond zonder verrassingen: alleen tracks die door de automatische
    // controle zijn gekomen of bewust door de admin zijn goedgekeurd.
    if (f.alleen_gecontroleerd === true) {
        condities.push(`EXISTS (SELECT 1 FROM tracks vc
                                 WHERE vc.titel_id = t.id
                                   AND vc.werkt = true
                                   AND vc.bron = 'lokaal'
                                   AND vc.itunes_track_id IS NULL
                                   AND (COALESCE(vc.review_status, 'open') = 'goedgekeurd'
                                        OR vc.review_handmatig = true
                                        OR (vc.gecontroleerd = true AND vc.verificatie_score >= 0.85))
                                   AND vc.preview_url IS NOT NULL
                                   AND vc.preview_url <> '')`);
    }

    // Een spel mag pas starten met audio die werkelijk op de server staat.
    // Externe YouTube/iTunes-verwijzingen zijn alleen materiaal voor het
    // admin-downloadproces en nooit een speelbare bron.
    if (f.alleen_lokaal === true) {
        condities.push(`EXISTS (SELECT 1 FROM tracks vl
                                 WHERE vl.titel_id = t.id
                                   AND vl.werkt = true
                                   AND vl.bron = 'lokaal'
                                   AND vl.itunes_track_id IS NULL
                                   AND vl.download_status = 'available'
                                   AND vl.preview_url IS NOT NULL
                                   AND vl.preview_url <> '')`);
    }

    const where = condities.length ? `WHERE ${condities.join(' AND ')}` : '';
    return { where, params };
}

module.exports = { bouwFilter };
