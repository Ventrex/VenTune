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
const AI_VERSIE = 1;

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
const VASTZETBAAR = ['naam', 'categorie', 'tier', 'jaar', 'nl', 'actief', 'franchise',
    'aliassen', 'nummer', 'hints', 'vragen', 'mp3'];

const STANDAARD_INSTELLINGEN = {
    aan: true,
    pauzeSeconden: 30,
    doelen: { film: 500, serie: 400, anime: 100, game: 500, muziek: 500, kerst: 150, kinder: 100 },
};

/** Een speelbare lokale MP3 voor titel-alias `t`. */
const HEEFT_MP3 = `EXISTS (SELECT 1 FROM tracks mp
    WHERE mp.titel_id = t.id AND mp.werkt = true AND mp.bron = 'lokaal'
      AND mp.download_status = 'available'
      AND COALESCE(NULLIF(mp.bestand_pad, ''), NULLIF(mp.preview_url, '')) IS NOT NULL)`;

const TIER_RANG = `CASE t.bekendheid_tier WHEN 'iconisch' THEN 0 WHEN 'algemeen_bekend' THEN 1
    WHEN 'bekend' THEN 2 WHEN 'cult' THEN 3 WHEN 'onbekend' THEN 4 ELSE 5 END`;

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
    nieuw.pauzeSeconden = Math.min(600, Math.max(5, Number(nieuw.pauzeSeconden) || 30));
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

/** Aantallen per categorie × bekendheid (alleen actieve titels). */
async function tellingen() {
    const { rows } = await pool.query(`
        SELECT COALESCE(t.categorie, t.type::text) AS categorie,
               COALESCE(t.bekendheid_tier, 'nog_niet') AS tier,
               count(*)::int AS totaal,
               count(*) FILTER (WHERE ${HEEFT_MP3})::int AS speelbaar
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
    TIER_VERDELING, VASTZETBAAR, HEEFT_MP3, TIER_RANG,
    typeVoorCategorie, isVast, norm, log, instellingen, bewaarInstellingen, tellingen, werkvoorraad,
};
