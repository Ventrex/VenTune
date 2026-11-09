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
    // Definitief afgekeurde titels mogen nooit terugkomen in een spel.
    condities.push("COALESCE(t.curatie_status::text,'') <> 'uitgesloten'");
    // Open meldingen pauzeren een titel tijdelijk voor nieuwe spellen.
    // Een admin kan de melding herstellen of afwijzen; de MP3 en historiek blijven intact.
    condities.push(`NOT EXISTS (
        SELECT 1 FROM meldingen m
        WHERE m.titel_id=t.id AND m.afgehandeld=false
    )`);


    // Inhoudscategorie. Sinds Beheer 2.0 bepaalt de AI per titel de
    // categorie (film, serie, anime, game, muziek, kerst, kinder). Anime
    // staat los van films/series; alleen anime die in Nederland breed bekend
    // is (anime_breed_bekend, bv. Pokémon) mag ook in een film-/seriequiz.
    // Muziek omvat ook kerst- en kindermuziek, maar nooit gamemuziek.
    const CAT = "COALESCE(t.categorie, t.type::text)";
    const toegestaan = ['film', 'serie', 'muziek', 'anime', 'game', 'kerst', 'kinder'];
    let gekozen = Array.isArray(f.categorieen)
        ? f.categorieen.filter((c) => toegestaan.includes(c))
        : [];
    if (f.game_only === true || f.categorie === 'games') gekozen = ['game'];
    else if (!gekozen.length) {
        if (f.categorie === 'films') gekozen = ['film'];
        else if (f.categorie === 'series') gekozen = ['serie'];
        else if (f.categorie === 'muziek') gekozen = ['muziek'];
        else if (f.categorie === 'anime') gekozen = ['anime'];
        else gekozen = ['film', 'serie'];
    }
    const sqlCats = new Set(gekozen);
    if (sqlCats.has('muziek')) { sqlCats.add('kerst'); sqlCats.add('kinder'); }
    // Een muziekcollectie (Rock, Sinterklaas) draait om het nummer: daar
    // horen ook films/series/games bij waarvan het nummer past, zoals Rocky
    // met Eye of the Tiger. Het nummer wordt hergebruikt, geen dubbele MP3.
    const heeftCollectie = (Array.isArray(f.collecties) && f.collecties.length) || (f.collectie && f.collectie !== 'alles');
    if (heeftCollectie && gekozen.length === 1 && gekozen[0] === 'muziek') toegestaan.forEach((c) => sqlCats.add(c));
    params.push([...sqlCats]);
    const catParam = params.length;
    const filmSerie = gekozen.filter((c) => c === 'film' || c === 'serie');
    if (filmSerie.length && !sqlCats.has('anime')) {
        params.push(filmSerie);
        condities.push(`(${CAT} = ANY($${catParam}::text[])
            OR (${CAT} = 'anime' AND t.anime_breed_bekend = true AND t.type::text = ANY($${params.length}::text[])))`);
    } else {
        condities.push(`${CAT} = ANY($${catParam}::text[])`);
    }

    // Bekendheid volgens de AI: iconisch, algemeen bekend, bekend, onbekend
    // of cult. Leeg = alles. Nog niet beoordeelde titels tellen als 'bekend'.
    const TIERS = ['iconisch', 'algemeen_bekend', 'bekend', 'onbekend', 'cult'];
    const tiers = Array.isArray(f.tiers) ? f.tiers.filter((x) => TIERS.includes(x)) : [];
    if (tiers.length && tiers.length < TIERS.length) {
        params.push(tiers);
        condities.push(`COALESCE(t.bekendheid_tier, 'bekend') = ANY($${params.length}::text[])`);
    }

    // Consoles/fabrikanten zijn afzonderlijke catalogustags; de selectie
    // toont nooit nummers uit een andere fabrikant als er één is gekozen.
    // Alle vijf aangevinkt = geen beperking. Tags als "Nintendo Switch",
    // "PS4" of "Mega Drive" tellen ook voor hun fabrikant.
    if (gekozen.includes('game') && Array.isArray(f.platformen) && f.platformen.length) {
        const PATRONEN = {
            nintendo: 'nintendo|wii|switch|game ?boy|gamecube|\\mnes\\M|snes|n64|\\mds\\M|3ds',
            sega: 'sega|mega ?drive|genesis|dreamcast|saturn|master system|game gear',
            playstation: 'playstation|\\mps[1-5]?\\M|\\mpsp\\M|vita',
            xbox: 'xbox',
            pc: '\\mpc\\M|windows|steam|\\mdos\\M|ms-dos|\\mmac',
        };
        const geldig = [...new Set(f.platformen.filter((v) => PATRONEN[v]))];
        if (geldig.length && geldig.length < 5) {
            params.push(geldig.map((v) => PATRONEN[v]).join('|'));
            condities.push(`EXISTS (
                SELECT 1 FROM unnest(
                    COALESCE(t.themas, '{}'::text[]) ||
                    COALESCE(t.muziek_genres, '{}'::text[]) ||
                    COALESCE(t.genres, '{}'::text[])
                ) AS platform(naam)
                WHERE lower(platform.naam) ~ $${params.length}
            )`);
        }
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
    const jaarStartParam = String.fromCharCode(36) + iStart;
    const jaarEindParam = String.fromCharCode(36) + iEind;
    condities.push(`(t.jaar BETWEEN ${jaarStartParam}::integer AND ${jaarEindParam}::integer OR (t.jaar IS NULL AND ${jaarStartParam}::integer <= 1930 AND ${jaarEindParam}::integer >= EXTRACT(YEAR FROM CURRENT_DATE)))`);

        // Bekendheid: alleen titels die genoeg mensen kennen. 'stemmen' uit TMDB
    // is hiervoor de betrouwbaarste maat. Titels zonder TMDB-gegevens (zoals
    // handmatig of via playlists toegevoegde) blijven altijd meedoen.
    const drempel = Number(f.min_bekendheid);
    if (Number.isFinite(drempel) && drempel > 0) {
        const bekendheidsniveau = drempel >= 4000 ? 3 : drempel >= 1000 ? 2 : 1;
        const viewsDrempel = bekendheidsniveau === 3 ? 5000000
            : bekendheidsniveau === 2 ? 1000000 : 250000;
        params.push(drempel);
        const stemmenParam = params.length;
        params.push(viewsDrempel);
        const viewsParam = params.length;
        params.push(bekendheidsniveau);
        const niveauParam = params.length;
        condities.push(
            `(t.bekendheid_score >= $${niveauParam}
              OR t.stemmen >= $${stemmenParam}
              OR t.youtube_max_views >= $${viewsParam}
              OR t.tmdb_id IS NULL)`,
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
    // Genrekeuze in Nieuw spel (vaste VenTune-genres: Komedie, Actie, Rock …).
    if (Array.isArray(f.genre_keuze) && f.genre_keuze.length > 0) {
        params.push(f.genre_keuze.map((g) => String(g).slice(0, 40)));
        condities.push(`t.ai_genres && $${params.length}::text[]`);
    }
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
    // Verouderde curatievlag niet meer toepassen: lokale MP3 + werkt +
    // download_status worden afzonderlijk gecontroleerd.
    // Laat de instelling voor oude presets bestaan, maar blokkeer geen tracks.


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
                                   AND vc.wacht_op_swipe = false
                                   AND vc.bron = 'lokaal'
                                   AND vc.itunes_track_id IS NULL
                                   AND (COALESCE(vc.review_status, 'open') = 'goedgekeurd'
                                        OR vc.review_handmatig = true)
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
                                   AND vl.wacht_op_swipe = false
                                   AND vl.bron = 'lokaal'
                                   AND vl.download_status = 'available'
                                   AND COALESCE(NULLIF(vl.bestand_pad, ''), NULLIF(vl.preview_url, '')) IS NOT NULL)`);
    }

    const where = condities.length ? `WHERE ${condities.join(' AND ')}` : '';
    return { where, params };
}

module.exports = { bouwFilter };
