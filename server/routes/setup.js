// =====================================================================
// Setup-routes: telling van beschikbare titels en presets.
//
//   GET    /api/tracks/telling?categorie=&taal=&start=&eind=
//   GET    /api/presets
//   POST   /api/presets
//   DELETE /api/presets/:id
//
// De telling voedt het laatste filterscherm: onder de drempel mag de host
// niet starten.
// =====================================================================

const express = require('express');
const { pool } = require('../db/pool');
const { bouwFilter } = require('../game/filters');
const logger = require('../lib/logger');

const router = express.Router();

// Minimaal aantal speelbare titels om te mogen starten.
const MIN_TITELS = 15;

// Publieke collectieknoppen voor de host. Alleen actieve collecties worden
// getoond; de admin kan later nieuwe edities toevoegen zonder frontend-build.
router.get('/api/collecties', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.sleutel, c.naam, c.beschrijving, c.standaard_type,
                    COUNT(tc.titel_id)::int AS aantal
               FROM collecties c
               LEFT JOIN titel_collecties tc ON tc.collectie_id = c.id
              WHERE c.actief = true
              GROUP BY c.id
              ORDER BY c.naam ASC`,
        );
        res.json(rows);
    } catch (err) {
        logger.waarschuwing('Collecties ophalen mislukt.', { melding: err.message });
        res.json([]);
    }
});

// Publieke, niet-gevoelige huisstijl-instellingen. Het admin-wachtwoord en
// andere operationele waarden zitten nooit in deze response.
router.get('/api/instellingen', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT waarde FROM app_instellingen WHERE sleutel = 'thema' LIMIT 1`,
        );
        res.json(rows[0]?.waarde || {});
    } catch (err) {
        logger.waarschuwing('Publieke instellingen ophalen mislukt.', { melding: err.message });
        res.json({});
    }
});

// Live telling van titels/tracks die aan de filters voldoen.
router.get('/api/tracks/telling', async (req, res) => {
    const filter = {
        categorie: req.query.categorie,
        categorieen: req.query.categorieen
            ? String(req.query.categorieen).split(',').filter(Boolean)
            : [],
        taal: req.query.taal,
        periode_start: Number(req.query.start),
        periode_eind: Number(req.query.eind),
        min_bekendheid: Number(req.query.bekendheid),
        zonder_genres: req.query.zonder
            ? String(req.query.zonder).split(',').filter(Boolean)
            : [],
        collecties: req.query.collectie && String(req.query.collectie) !== 'alles'
            ? String(req.query.collectie).split(',').filter(Boolean)
            : [],
        leeftijd_max: Number(req.query.leeftijd_max),
        kindvriendelijk: req.query.kindvriendelijk === 'true',
        alleen_nl_tv: req.query.alleen_nl_tv !== 'false',
        alleen_gecontroleerd: req.query.alleen_gecontroleerd === 'true',
    };
    const { where, params } = bouwFilter(filter);

    try {
        const { rows } = await pool.query(
            `SELECT COUNT(DISTINCT t.id)::int AS catalogus,
                    COUNT(DISTINCT t.id) FILTER (WHERE tr.id IS NOT NULL)::int AS titels,
                    COUNT(tr.id)::int AS tracks
               FROM titels t
               LEFT JOIN tracks tr ON tr.titel_id = t.id
                                  AND tr.werkt = true
                                  AND tr.preview_url IS NOT NULL
                                  AND tr.preview_url <> ''
                                  AND ($${params.length + 1}::boolean = false
                                       OR (tr.gecontroleerd = true AND tr.verificatie_score >= 0.85))
               ${where}`,
            [...params, filter.alleen_gecontroleerd === true],
        );
        const titels = rows[0].titels;
        res.json({
            titels,
            speelbare_titels: titels,
            catalogus: rows[0].catalogus,
            tracks: rows[0].tracks,
            drempel: MIN_TITELS,
            genoeg: titels >= MIN_TITELS,
        });
    } catch (err) {
        logger.fout('Telling mislukt.', { melding: err.message });
        res.status(500).json({ fout: 'Kon de telling niet ophalen.' });
    }
});

// Presets ophalen (nieuwste eerst).
router.get('/api/presets', async (_req, res) => {
    const { rows } = await pool.query(
        `SELECT id, naam, categorie, categorieen, taal, periode_start, periode_eind,
                rondes, speeltijd, modus, min_bekendheid, zonder_genres,
                leeftijd_max, alleen_nl_tv, collecties,
                antwoord_modus, leeftijd_deelnemer_min, leeftijd_deelnemer_max,
               leeftijdspunten_aan, leeftijdsfactoren, alleen_gecontroleerd,
               kindvriendelijk,
                aangemaakt_op
           FROM presets
          ORDER BY aangemaakt_op DESC`,
    );
    res.json(rows);
});

// Preset opslaan.
router.post('/api/presets', async (req, res) => {
    const b = req.body || {};
    const naam = String(b.naam || '').trim().slice(0, 40);
    if (!naam) return res.status(400).json({ fout: 'Geef de preset een naam.' });

    try {
        const { rows } = await pool.query(
            `INSERT INTO presets
               (naam, categorie, categorieen, taal, periode_start, periode_eind, rondes,
                speeltijd, modus, min_bekendheid, zonder_genres, leeftijd_max,
                alleen_nl_tv, antwoord_modus, collecties, leeftijd_deelnemer_min,
                leeftijd_deelnemer_max, leeftijdspunten_aan, leeftijdsfactoren,
                gebruiker_id, alleen_gecontroleerd, kindvriendelijk)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
             RETURNING id, naam, categorie, categorieen, taal, periode_start, periode_eind,
                       rondes, speeltijd, modus, min_bekendheid, zonder_genres,
                       leeftijd_max, alleen_nl_tv, antwoord_modus, collecties,
                       leeftijd_deelnemer_min, leeftijd_deelnemer_max,
                       leeftijdspunten_aan, leeftijdsfactoren, gebruiker_id,
                       alleen_gecontroleerd, kindvriendelijk, aangemaakt_op`,
            [
                naam,
                b.categorie || 'beide',
                Array.isArray(b.categorieen) ? b.categorieen : [],
                b.taal || 'beide',
                Number.isFinite(b.periode_start) ? b.periode_start : 1930,
                Number.isFinite(b.periode_eind) ? b.periode_eind : 2100,
                Number.isFinite(b.rondes) ? b.rondes : 10,
                Number.isFinite(b.speeltijd) ? b.speeltijd : 0,
                b.modus === 'kenner' ? 'kenner' : 'snelste',
                Number.isFinite(b.min_bekendheid) ? b.min_bekendheid : 0,
                Array.isArray(b.zonder_genres) ? b.zonder_genres : [],
                Number.isFinite(b.leeftijd_max) ? b.leeftijd_max : 0,
                b.alleen_nl_tv !== false,
                b.antwoord_modus === 'meerkeuze' ? 'meerkeuze' : 'typen',
                Array.isArray(b.collecties) ? b.collecties : [],
                Number.isInteger(b.leeftijd_deelnemer_min) ? b.leeftijd_deelnemer_min : 4,
                Number.isInteger(b.leeftijd_deelnemer_max) ? b.leeftijd_deelnemer_max : 99,
                b.leeftijdspunten_aan === true,
                b.leeftijdsfactoren || { 6: 2, 9: 1.75, 12: 1.5, 16: 1.25, 18: 1 },
                (await require('../lib/auth').gebruikerUitRequest(req))?.id || null,
                b.alleen_gecontroleerd === true,
                b.kindvriendelijk === true,
            ],
        );
        res.json(rows[0]);
    } catch (err) {
        logger.fout('Preset opslaan mislukt.', { melding: err.message });
        res.status(500).json({ fout: 'Kon de preset niet opslaan.' });
    }
});

// Preset verwijderen.
router.delete('/api/presets/:id', async (req, res) => {
    await pool.query(`DELETE FROM presets WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
});

// Ranglijsten over afgeronde spellen. Scores worden zowel per spel als per
// gespeelde ronde berekend, zodat een eindeloos spel niet automatisch wint
// van een spel met tien vragen.
router.get('/api/ranking', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `WITH per_spel AS (
                SELECT p.naam,
                       p.gebruiker_id,
                       p.score,
                       l.id AS lobby_id,
                       COUNT(DISTINCT r.id)::int AS gespeelde_rondes
                  FROM spelers p
                  JOIN lobbies l ON l.id = p.lobby_id
                  LEFT JOIN rondes r ON r.lobby_id = l.id
                 WHERE l.status = 'afgelopen'
                 GROUP BY p.id, p.naam, p.gebruiker_id, p.score, l.id
            ), aggregatie AS (
                SELECT COALESCE(gebruiker_id::text, 'gast:' || lower(trim(naam))) AS sleutel,
                       MAX(naam) AS naam,
                       COUNT(*)::int AS spellen,
                       SUM(score)::int AS totaal,
                       MAX(score)::int AS beste,
                       ROUND(AVG(score)::numeric, 1) AS gemiddelde,
                       SUM(gespeelde_rondes)::int AS rondes,
                       ROUND(AVG(
                           CASE WHEN gespeelde_rondes > 0
                                THEN score::numeric / gespeelde_rondes
                                ELSE 0 END
                       ), 1) AS punten_gemiddeld
                  FROM per_spel
                 GROUP BY COALESCE(gebruiker_id::text, 'gast:' || lower(trim(naam)))
            )
            SELECT sleutel, naam, spellen, totaal, beste, gemiddelde, rondes,
                   punten_gemiddeld
              FROM aggregatie
             WHERE spellen > 0`,
        );
        const sorteer = (veld) => rows
            .slice()
            .sort((a, b) => Number(b[veld] || 0) - Number(a[veld] || 0)
                || Number(b.spellen || 0) - Number(a.spellen || 0)
                || String(a.naam).localeCompare(String(b.naam), 'nl'))
            .slice(0, 10);
        const besteGemiddeld = sorteer('gemiddelde');
        res.json({
            // `ranking` blijft als compatibiliteitsveld bestaan voor oudere
            // clients; nieuwe clients gebruiken de drie duidelijke lijsten.
            ranking: besteGemiddeld,
            beste_gemiddeld: besteGemiddeld,
            meeste_spellen: sorteer('spellen'),
            punten_gemiddeld: sorteer('punten_gemiddeld'),
        });
    } catch (err) {
        logger.waarschuwing('Ranking ophalen mislukt.', { melding: err.message });
        res.json({ ranking: [], beste_gemiddeld: [], meeste_spellen: [], punten_gemiddeld: [] });
    }
});

module.exports = router;
