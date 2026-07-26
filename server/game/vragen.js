// =====================================================================
// Vragenbank. Per titel worden meerdere bonusvragen gegenereerd en in de
// database bewaard. Zo krijg je bij dezelfde titel niet steeds dezelfde
// vraag, en hoeft er tijdens het spel niets opgehaald te worden.
//
// De vragen komen uit gegevens die we al hebben (jaar, genre, type, land)
// plus, als er een TMDB-id is, regisseur en hoofdrolspeler.
// =====================================================================

const { pool } = require('../db/pool');
const tmdb = require('../lib/tmdb');
const logger = require('../lib/logger');

const GENRE_POOL = [
    'Actie', 'Avontuur', 'Animatie', 'Komedie', 'Misdaad', 'Documentaire',
    'Drama', 'Familie', 'Fantasy', 'Historisch', 'Horror', 'Musical',
    'Mysterie', 'Romantiek', 'Sciencefiction', 'Thriller', 'Oorlog',
    'Western', 'Kerst', 'Superhelden', 'Sport',
];

const LAND_POOL = [
    'Nederland', 'België', 'VS', 'VK', 'Duitsland', 'Frankrijk', 'Spanje',
    'Italië', 'Zweden', 'Denemarken', 'Japan', 'Zuid-Korea', 'Canada',
    'Australië', 'Ierland', 'Noorwegen', 'Mexico', 'Brazilië',
];

function hussel(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Kies tot n afleiders uit een pool, zonder het juiste antwoord. */
function afleiders(pool_, juist, n = 5) {
    const juistLaag = String(juist).toLowerCase();
    const uniek = [];
    for (const k of hussel(pool_)) {
        if (!k || String(k).toLowerCase() === juistLaag) continue;
        if (uniek.some((u) => String(u).toLowerCase() === String(k).toLowerCase())) {
            continue;
        }
        uniek.push(k);
        if (uniek.length >= n) break;
    }
    return uniek;
}

/** Bouw een vraagobject met zes opties en het juiste antwoord erin. */
function maakVraag(soort, vraag, juist, afleiderLijst) {
    if (afleiderLijst.length < 5) return null;
    const opties = hussel([juist, ...afleiderLijst.slice(0, 5)]);
    return {
        soort,
        vraag,
        opties,
        correct_index: opties.findIndex((o) => o === juist),
    };
}

/**
 * Genereer vragen uit de gegevens die we al hebben (geen netwerk nodig).
 * Levert er doorgaans 3 tot 5 per titel.
 */
function bouwBasisVragen(titel) {
    const vragen = [];
    const naam = titel.naam;

    // 1. Jaar
    if (Number.isFinite(titel.jaar)) {
        const jaarAfleiders = hussel([-8, -6, -4, -3, -2, 2, 3, 4, 6, 8])
            .slice(0, 5)
            .map((o) => String(titel.jaar + o));
        const v = maakVraag(
            'jaar',
            `In welk jaar kwam ${naam} uit?`,
            String(titel.jaar),
            jaarAfleiders,
        );
        if (v) vragen.push(v);

        // 2. Nogmaals een echt jaar. Een decennium maakt de bonusvraag te
        // eenvoudig (en geeft vooral bij jaren 90 weinig informatie).
        const jaarAfleiders2 = hussel([-12, -9, -6, -3, 3, 6, 9, 12])
            .slice(0, 5)
            .map((o) => String(titel.jaar + o));
        const v2 = maakVraag(
            'releasejaar',
            `Welk jaar hoort bij de eerste release van ${naam}?`,
            String(titel.jaar),
            jaarAfleiders2,
        );
        if (v2) vragen.push(v2);
    }

    // 3. Genre
    if ((titel.genres || []).length > 0) {
        const juist = titel.genres[0];
        const pool_ = GENRE_POOL.filter((g) => !titel.genres.includes(g));
        const v = maakVraag(
            'genre',
            `Tot welk genre behoort ${naam}?`,
            juist,
            afleiders(pool_, juist),
        );
        if (v) vragen.push(v);
    }

    // 4. Land
    if (titel.land) {
        const pool_ = LAND_POOL.filter((l) => l !== titel.land);
        const v = maakVraag(
            'land',
            `Uit welk land komt ${naam}?`,
            titel.land,
            afleiders(pool_, titel.land),
        );
        if (v) vragen.push(v);
    }

    // 5. Film of serie — als meerkeuze met plausibele alternatieven.
    const typeJuist = titel.type === 'serie' ? 'Serie' : 'Film';
    const v5 = maakVraag(
        'type',
        `Is ${naam} een film of een serie?`,
        typeJuist,
        typeJuist === 'Film'
            ? ['Serie', 'Documentaire', 'Korte film', 'Miniserie', 'Realityshow']
            : ['Film', 'Documentaire', 'Realityshow', 'Korte film', 'Televisiefilm'],
    );
    if (v5) vragen.push(v5);

    return vragen;
}

/**
 * Extra vragen via TMDB (regisseur, hoofdrolspeler). Alleen als er een
 * TMDB-id en een key is; anders worden ze overgeslagen.
 */
async function bouwTmdbVragen(titel) {
    if (!tmdb.beschikbaar() || !titel.tmdb_id) return [];
    const vragen = [];
    try {
        const details = await tmdb.haalDetails(titel.tmdb_id, titel.type);
        let pool_ = { regisseurs: [], acteurs: [] };
        if (details.genreIds && details.genreIds.length) {
            pool_ = await tmdb.haalAfleiderPool(
                details.genreIds[0],
                titel.type,
                titel.tmdb_id,
            );
        }
        if (details.regisseur && pool_.regisseurs.length >= 3) {
            const v = maakVraag(
                'regisseur',
                `Wie regisseerde ${titel.naam}?`,
                details.regisseur,
                afleiders(pool_.regisseurs, details.regisseur),
            );
            if (v) vragen.push(v);
        }
        if ((details.cast || []).length > 0 && pool_.acteurs.length >= 3) {
            const juist = details.cast[0];
            const pool2 = pool_.acteurs.filter((a) => !details.cast.includes(a));
            const v = maakVraag(
                'acteur',
                `Wie speelt een hoofdrol in ${titel.naam}?`,
                juist,
                afleiders(pool2, juist),
            );
            if (v) vragen.push(v);
        }
    } catch (err) {
        logger.waarschuwing('TMDB-vragen overgeslagen.', { melding: err.message });
    }
    return vragen;
}

/** Sla vragen op (dubbele worden genegeerd). Geeft het aantal nieuwe terug. */
async function bewaarVragen(titelId, vragen) {
    let nieuw = 0;
    for (const v of vragen) {
        const res = await pool.query(
            `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index)
             VALUES ($1, $2, $3, $4::jsonb, $5)
             ON CONFLICT (titel_id, soort, vraag) DO UPDATE SET
               opties = EXCLUDED.opties,
               correct_index = EXCLUDED.correct_index
             WHERE jsonb_array_length(vragen.opties) < 6`,
            [titelId, v.soort, v.vraag, JSON.stringify(v.opties), v.correct_index],
        );
        if (res.rowCount > 0) nieuw++;
    }
    return nieuw;
}

/**
 * Zorg dat een titel minstens `minimaal` vragen heeft. Genereert wat er
 * nog mist en bewaart die.
 */
async function vulAan(titel, minimaal = 3, metTmdb = false) {
    const { rows } = await pool.query(
        `SELECT count(*)::int AS n
           FROM vragen
          WHERE titel_id = $1
            AND jsonb_array_length(opties) >= 6`,
        [titel.id],
    );
    if (rows[0].n >= minimaal) return 0;

    let vragen = bouwBasisVragen(titel);
    if (metTmdb && vragen.length < minimaal + 1) {
        vragen = vragen.concat(await bouwTmdbVragen(titel));
    }
    return bewaarVragen(titel.id, vragen);
}

/**
 * Haal een vraag voor deze titel op. Kiest bij voorkeur een vraag die in
 * deze lobby nog niet gebruikt is, en anders de minst gebruikte.
 *
 * @param {number} titelId
 * @param {Set<number>} alGebruikt  vraag-id's die deze lobby al had
 * @param {Function|null} geldig    optionele inhoudscontrole vóór gebruik
 */
async function haalVraag(titelId, alGebruikt = new Set(), geldig = null) {
    const { rows } = await pool.query(
        `SELECT id, soort, vraag, opties, correct_index
           FROM vragen
          WHERE titel_id = $1
            AND jsonb_array_length(opties) >= 6
          ORDER BY keer_gebruikt ASC, random()
          LIMIT 10`,
        [titelId],
    );
    if (rows.length === 0) return null;

    const bruikbaar = geldig ? rows.filter((r) => geldig({
        id: r.id,
        soort: r.soort,
        vraag: r.vraag,
        opties: r.opties,
        correctIndex: r.correct_index,
    })) : rows;
    if (bruikbaar.length === 0) return null;
    const vers = bruikbaar.find((r) => !alGebruikt.has(r.id));
    const gekozen = vers || bruikbaar[0];

    await pool.query(
        `UPDATE vragen SET keer_gebruikt = keer_gebruikt + 1 WHERE id = $1`,
        [gekozen.id],
    );
    return {
        id: gekozen.id,
        soort: gekozen.soort,
        vraag: gekozen.vraag,
        opties: gekozen.opties,
        correctIndex: gekozen.correct_index,
    };
}

module.exports = {
    bouwBasisVragen,
    bouwTmdbVragen,
    bewaarVragen,
    vulAan,
    haalVraag,
    maakVraag,
};
