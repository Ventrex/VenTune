// =====================================================================
// Beheer 2.0 — gedeelde begrippen voor de vragenbank.
//
// Eén plek voor categorieën, bekendheidsniveaus, de velden die een
// beheerder kan vastzetten, het logboek en de instellingen van de
// AI-curator. Zowel de worker als de admin-routes gebruiken dit bestand.
// =====================================================================

const { pool } = require('../db/pool');
const logger = require('./logger');

// Ophogen wanneer de beoordelingsprompt inhoudelijk verandert: alle titels
// worden dan opnieuw door de AI bekeken (handmatige velden blijven staan).
const AI_VERSIE = 5; // 3: bekendheid titel+nummer, anime binnen anime, eerdere: taal/land/eindjaar

const CATEGORIEEN = ['film', 'serie', 'anime', 'game', 'muziek', 'kerst', 'kinder'];
const CATEGORIE_LABEL = {
    film: 'Films', serie: 'Series', anime: 'Anime', game: 'Videogames',
    muziek: 'Muziek', kerst: 'Kerst', kinder: 'Kinder',
};
const MUZIEK_CATEGORIEEN = new Set(['muziek', 'kerst', 'kinder']);

const TIERS = ['iconisch', 'algemeen_bekend', 'bekend', 'onbekend', 'cult'];
const TIER_LABEL = {
    iconisch: 'Iconisch', algemeen_bekend: 'Algemeen bekend', bekend: 'Bekend',
    onbekend: 'Onbekend', cult: 'Cult',
};
// Gewenste verdeling als de AI een categorie aanvult.
const TIER_VERDELING = { iconisch: 0.2, algemeen_bekend: 0.25, bekend: 0.25, onbekend: 0.15, cult: 0.15 };

// Velden die de beheerder kan aanpassen. Na een aanpassing staat het veld
// in titels.handmatig en blijft de AI eraf.
const VASTZETBAAR = ['naam', 'categorie', 'tier', 'jaar', 'nl', 'taal', 'actief', 'franchise',
    'aliassen', 'nummer', 'hints', 'vragen', 'mp3', 'genres'];

// Vaste genrelijst, zodat je in Nieuw spel kunt kiezen voor bv. alleen
// komedieseries of alleen actiegames. De AI kiest per titel 1-3 genres.
const GENRES_BEELD = ['Actie', 'Avontuur', 'Animatie', 'Komedie', 'Sitcom', 'Drama', 'Fantasy', 'Sciencefiction',
    'Horror', 'Thriller', 'Misdaad', 'Mysterie', 'Romantiek', 'Familie', 'Kinderserie', 'Musical', 'Western',
    'Oorlog', 'Sport', 'Superhelden', 'Historisch', 'Documentaire'];
const GENRES_GAME = ['Actie', 'Avontuur', 'Platform', 'RPG', 'Shooter', 'Race', 'Sport', 'Vechtspel', 'Puzzel',
    'Strategie', 'Simulatie', 'Horror', 'Party', 'Open wereld', 'Muziek', 'Indie'];
const GENRES_MUZIEK = ['Pop', 'Rock', 'Metal', 'Punk', 'Alternatief', 'Indie', 'Hiphop', 'R&B', 'Soul', 'Funk',
    'Disco', 'Dance', 'Reggae', 'Latin', 'Country', 'Blues', 'Jazz', 'Klassiek', 'Schlager', 'Levenslied',
    'Nederpop', 'Singer-songwriter', 'Soundtrack', 'Kinderlied', 'Kerst'];
const ALLE_GENRES = [...new Set([...GENRES_BEELD, ...GENRES_GAME, ...GENRES_MUZIEK])];
function genresVoor(categorie) {
    if (categorie === 'game') return GENRES_GAME;
    if (['muziek', 'kerst', 'kinder'].includes(categorie)) return GENRES_MUZIEK;
    return GENRES_BEELD;
}
function schoonGenres(lijst, categorie) {
    const geldig = new Set(genresVoor(categorie));
    return [...new Set((Array.isArray(lijst) ? lijst : []).filter((g) => geldig.has(g)))].slice(0, 3);
}

const STANDAARD_INSTELLINGEN = {
    aan: true,
    pauzeSeconden: 120,
    // Zuinig met het ChatGPT-abonnement: maximaal zoveel AI-vragen per dag
    // (0 = onbeperkt), webzoeken alleen bij beoordelen, en een vaste pauze
    // tot een tijdstip (na een limiet of zelf ingesteld).
    maxPerDag: 20,
    webZoeken: 'nooit',
    pauzeTot: null,
    voorrang: [], // categorieën die bij alles voorgaan, bv. ['game']
    doelen: { film: 500, serie: 400, anime: 100, game: 500, muziek: 500, kerst: 150, kinder: 100 },
};

/** Een speelbare lokale MP3 voor titel-alias `t`. */
const HEEFT_MP3 = `EXISTS (SELECT 1 FROM tracks mp
    WHERE mp.titel_id = t.id AND mp.werkt = true AND mp.bron = 'lokaal'
      AND mp.download_status = 'available'
      AND COALESCE(NULLIF(mp.bestand_pad, ''), NULLIF(mp.preview_url, '')) IS NOT NULL)`;

/** Speelbaar = lokaal én door de beheerder goedgekeurd (niet meer wachtend op een swipe). */
const HEEFT_SPEELBAAR = `EXISTS (SELECT 1 FROM tracks sp
    WHERE sp.titel_id = t.id AND sp.werkt = true AND sp.wacht_op_swipe = false AND sp.bron = 'lokaal'
      AND sp.download_status = 'available'
      AND COALESCE(NULLIF(sp.bestand_pad, ''), NULLIF(sp.preview_url, '')) IS NOT NULL)`;

// Iconisch gaat overal voor: eerst iconisch, dan algemeen bekend … cult.
// Nog niet beoordeelde titels komen na iconisch/algemeen bekend.
const TIER_RANG = `CASE t.bekendheid_tier WHEN 'iconisch' THEN 0 WHEN 'algemeen_bekend' THEN 1
    WHEN 'bekend' THEN 2 WHEN 'onbekend' THEN 3 WHEN 'cult' THEN 4 ELSE 5 END`;

/** SQL-volgorde: categorieën met voorrang eerst (param = text[]). */
function voorrangSql(param) {
    // Eerst titels uit een collectie met voorrang (bv. ★ Sinterklaas), dan
    // de categorieën met voorrang.
    return `EXISTS (SELECT 1 FROM titel_collecties tcv JOIN collecties cv ON cv.id = tcv.collectie_id
                     WHERE tcv.titel_id = t.id AND cv.voorrang AND cv.actief) DESC,
            (COALESCE(t.categorie, t.type::text) = ANY(${param}::text[])) DESC`;
}

/** Welk inhoudstype (enum titel_type) past bij een categorie. */
function typeVoorCategorie(categorie, huidig) {
    if (categorie === 'film' || categorie === 'serie') return categorie;
    if (categorie === 'anime') return huidig === 'film' ? 'film' : 'serie';
    return 'muziek';
}

function isVast(titel, veld) {
    return Array.isArray(titel?.handmatig) && titel.handmatig.includes(veld);
}

function norm(tekst) {
    return String(tekst || '').toLowerCase().normalize('NFKD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function log(titelId, soort, bericht, details = null) {
    try {
        await pool.query(
            'INSERT INTO bank_log (titel_id, soort, bericht, details) VALUES ($1, $2, $3, $4)',
            [titelId || null, soort, String(bericht).slice(0, 1000), details ? JSON.stringify(details) : null],
        );
    } catch (err) {
        logger.waarschuwing('bank_log schrijven mislukt', { melding: err.message });
    }
}

async function instellingen() {
    const { rows } = await pool.query("SELECT waarde FROM app_instellingen WHERE sleutel = 'ai_curator'");
    const w = rows[0]?.waarde || {};
    return {
        ...STANDAARD_INSTELLINGEN,
        ...w,
        doelen: { ...STANDAARD_INSTELLINGEN.doelen, ...(w.doelen || {}) },
    };
}

async function bewaarInstellingen(patch) {
    const huidig = await instellingen();
    const nieuw = { ...huidig, ...patch, doelen: { ...huidig.doelen, ...(patch.doelen || {}) } };
    nieuw.pauzeSeconden = Math.min(1800, Math.max(5, Number(nieuw.pauzeSeconden) || 120));
    nieuw.maxPerDag = Math.min(5000, Math.max(0, Math.round(Number(nieuw.maxPerDag) || 0)));
    if (!['altijd', 'belangrijk', 'nooit'].includes(nieuw.webZoeken)) nieuw.webZoeken = 'belangrijk';
    const pt = nieuw.pauzeTot ? new Date(nieuw.pauzeTot) : null;
    nieuw.pauzeTot = pt && !Number.isNaN(pt.getTime()) && pt > new Date() ? pt.toISOString() : null;
    nieuw.voorrang = [...new Set((Array.isArray(nieuw.voorrang) ? nieuw.voorrang : []).filter((c) => CATEGORIEEN.includes(c)))];
    for (const c of Object.keys(nieuw.doelen)) {
        if (!CATEGORIEEN.includes(c)) delete nieuw.doelen[c];
        else nieuw.doelen[c] = Math.min(20000, Math.max(0, Math.round(Number(nieuw.doelen[c]) || 0)));
    }
    await pool.query(
        `INSERT INTO app_instellingen (sleutel, waarde, bijgewerkt_op) VALUES ('ai_curator', $1, now())
         ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt_op = now()`,
        [JSON.stringify(nieuw)],
    );
    return nieuw;
}

/**
 * Teller voor de publieke changelog. soort: toegevoegd (nieuw speelbaar),
 * aangepast (gegevens verbeterd), hints (nieuwe hints/vragen).
 */
async function telDag(titelIdOfCategorie, soort, aantal = 1) {
    try {
        let categorie = titelIdOfCategorie;
        if (typeof titelIdOfCategorie === 'number') {
            const { rows } = await pool.query(
                `SELECT CASE WHEN COALESCE(categorie, type::text) IN ('kerst', 'kinder') THEN 'muziek'
                             ELSE COALESCE(categorie, type::text) END AS c FROM titels WHERE id = $1`, [titelIdOfCategorie]);
            categorie = rows[0]?.c;
        }
        if (!categorie || !aantal) return;
        await pool.query(
            `INSERT INTO database_dagstat (datum, categorie, soort, aantal) VALUES (CURRENT_DATE, $1, $2, $3)
             ON CONFLICT (datum, categorie, soort) DO UPDATE SET aantal = database_dagstat.aantal + EXCLUDED.aantal`,
            [categorie, soort, aantal]);
    } catch { /* changelog-teller is niet belangrijk */ }
}

// Dagteller voor het AI-budget (lokale datum van de server).
function vandaag() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function telAiGebruik() {
    await pool.query(
        `INSERT INTO app_instellingen (sleutel, waarde, bijgewerkt_op) VALUES ('ai_gebruik', jsonb_build_object('datum', $1::text, 'aantal', 1), now())
         ON CONFLICT (sleutel) DO UPDATE SET bijgewerkt_op = now(), waarde = CASE
             WHEN app_instellingen.waarde->>'datum' = $1 THEN jsonb_set(app_instellingen.waarde, '{aantal}', to_jsonb(COALESCE((app_instellingen.waarde->>'aantal')::int, 0) + 1))
             ELSE jsonb_build_object('datum', $1::text, 'aantal', 1) END`, [vandaag()]);
}
async function aiGebruikVandaag() {
    const { rows } = await pool.query("SELECT waarde FROM app_instellingen WHERE sleutel = 'ai_gebruik'");
    const w = rows[0]?.waarde;
    return w && w.datum === vandaag() ? Number(w.aantal) || 0 : 0;
}

/** Aantallen per categorie × bekendheid (alleen actieve titels). */
async function tellingen() {
    const { rows } = await pool.query(`
        SELECT COALESCE(t.categorie, t.type::text) AS categorie,
               COALESCE(t.bekendheid_tier, 'nog_niet') AS tier,
               count(*)::int AS totaal,
               count(*) FILTER (WHERE ${HEEFT_SPEELBAAR})::int AS speelbaar
          FROM titels t
         WHERE t.curatie_status <> 'uitgesloten'
         GROUP BY 1, 2`);
    const uit = {};
    for (const c of CATEGORIEEN) uit[c] = { totaal: 0, speelbaar: 0, tiers: {} };
    for (const r of rows) {
        if (!uit[r.categorie]) continue;
        uit[r.categorie].totaal += r.totaal;
        uit[r.categorie].speelbaar += r.speelbaar;
        uit[r.categorie].tiers[r.tier] = { totaal: r.totaal, speelbaar: r.speelbaar };
    }
    return uit;
}

/** Hoeveel werk er nog ligt; voor het overzicht en de worker. */
async function werkvoorraad() {
    const { rows } = await pool.query(`
        SELECT
          count(*) FILTER (WHERE t.ai_status <> 'klaar' OR t.ai_versie < $1)::int AS te_beoordelen,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten' AND t.ai_status = 'klaar'
                             AND COALESCE(array_length(t.ai_hints, 1), 0) < 3)::int AS zonder_hints,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten' AND t.ai_status = 'klaar'
                             AND NOT EXISTS (SELECT 1 FROM vragen v WHERE v.titel_id = t.id
                                 AND v.ai_review_status <> 'afgekeurd'))::int AS zonder_vragen,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten' AND NOT ${HEEFT_MP3})::int AS zonder_mp3,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten' AND NOT ${HEEFT_MP3}
                             AND t.zoek_status = 'opgegeven')::int AS mp3_opgegeven,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten' AND EXISTS (SELECT 1 FROM tracks ws
                             WHERE ws.titel_id = t.id AND ws.wacht_op_swipe AND ws.werkt
                               AND ws.download_status = 'available'))::int AS te_swipen,
          count(*) FILTER (WHERE t.nl_bekend = 'nee')::int AS nl_nee,
          count(*) FILTER (WHERE t.nl_bekend = 'twijfel' AND t.curatie_status <> 'uitgesloten')::int AS nl_twijfel,
          count(*) FILTER (WHERE t.curatie_status = 'uitgesloten')::int AS uitgesloten,
          count(*) FILTER (WHERE t.curatie_status <> 'uitgesloten')::int AS actief
        FROM titels t`, [AI_VERSIE]);
    return rows[0];
}

/**
 * Draait de AI-curator? Dan blijven de oude automatische vullers (TMDB-
 * catalogus elk uur, swipe-achtergrondwachtrij elke minuut) stil: die
 * pompten ongecontroleerd titels in de bank en vroegen ChatGPT
 * tegelijkertijd om dingen. Met VENTUNE_OUDE_AUTOMATISERING=true draaien
 * ze toch.
 */
async function oudeAutomatiseringToegestaan() {
    if (process.env.VENTUNE_OUDE_AUTOMATISERING === 'true') return true;
    try { return !(await instellingen()).aan; } catch { return false; }
}

module.exports = {
    oudeAutomatiseringToegestaan,
    AI_VERSIE, CATEGORIEEN, CATEGORIE_LABEL, MUZIEK_CATEGORIEEN, TIERS, TIER_LABEL,
    TIER_VERDELING, VASTZETBAAR, HEEFT_MP3, HEEFT_SPEELBAAR, TIER_RANG,
    GENRES_BEELD, GENRES_GAME, GENRES_MUZIEK, ALLE_GENRES, genresVoor, schoonGenres,
    telAiGebruik, aiGebruikVandaag, telDag,
    voorrangSql, typeVoorCategorie, isVast, norm, log, instellingen, bewaarInstellingen, tellingen, werkvoorraad,
};
