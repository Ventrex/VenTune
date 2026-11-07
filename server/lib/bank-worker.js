// =====================================================================
// Beheer 2.0 — de AI-curator die 24/7 doorloopt.
//
// Eén lus, één AI-vraag tegelijk, met een instelbare pauze ertussen zodat
// het ChatGPT-abonnement niet overbelast raakt. Elke ronde pakt de
// volgende stap uit een vaste cyclus:
//
//   beoordelen  categorie, bekendheid, NL-check, jaar, franchise, nummer
//   mp3         ontbrekende MP3's zoeken; de AI kiest de juiste video
//   quiz        3 hints + 3 bonusvragen per titel (ook games en muziek)
//   aanvullen   categorieën onder hun doelaantal laten aanvullen
//   verbeteren  meldingen afhandelen, dubbelen, MP3-controle, steekproef
//
// De AI keurt alles zelf goed. Alles wat de beheerder aanpast staat in
// titels.handmatig en wordt nooit meer door de AI overschreven.
// =====================================================================

const { pool } = require('../db/pool');
const codex = require('./codex');
const ytzoek = require('./ytzoek');
const bank = require('./bank');
const bankAi = require('./bank-ai');
const bankMp3 = require('./bank-mp3');
const logger = require('./logger');

const CYCLUS = ['beoordelen', 'mp3', 'quiz', 'beoordelen', 'mp3', 'aanvullen', 'quiz', 'verbeteren'];
// Alles gaat in lijsten: één AI-vraag per lijst van dezelfde categorie.
const BATCH = { beoordelen: 25, quiz: 8, mp3: 6, aanvullen: 25 };
const PERIODES = {
    film: ['1970-1984', '1985-1994', '1995-2004', '2005-2014', '2015-nu'],
    serie: ['1970-1989', '1990-1999', '2000-2009', '2010-2017', '2018-nu'],
    anime: ['1980-1999', '2000-2012', '2013-nu'],
    game: ['1980-1994', '1995-2004', '2005-2014', '2015-nu'],
    muziek: ['1960-1979', '1980-1989', '1990-1999', '2000-2009', '2010-2019', '2020-nu'],
    kerst: [null],
    kinder: [null],
};

const status = {
    stap: 'opstarten',
    bericht: '',
    sinds: Date.now(),
    pauzeTot: 0,
    laatsteFout: null,
    laatsteActie: null,
    tellers: { beoordeeld: 0, quiz: 0, mp3: 0, toegevoegd: 0, verbeterd: 0 },
    gestart: false,
};
let cyclusIndex = 0;
let wekker = null;
let verbeterIndex = 0;
let laatsteVerbeter = 0;
const periodeIndex = {};
const uitgeput = {}; // `${categorie}|${periode}|${tier}` -> tot wanneer overslaan

function zet(stap, bericht = '') {
    status.stap = stap;
    status.bericht = bericht;
    status.sinds = Date.now();
}

function slaap(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => { wekker = null; resolve(); }, ms);
        wekker = () => { clearTimeout(timer); wekker = null; resolve(); };
    });
}

/** Lus wakker maken (na een actie van de beheerder). */
function porren() { if (wekker) wekker(); }

class AiFout extends Error {}

function controleerAi(res) {
    if (res.ok) return;
    const e = new AiFout(res.error || 'AI-fout');
    if (/limiet/i.test(res.error || '')) e.limiet = true;
    if (/gekoppeld/i.test(res.error || '')) e.login = true;
    throw e;
}

// ------------------------------------------------------------------
// Stap: beoordelen
// ------------------------------------------------------------------

async function stapBeoordelen(inst) {
    const voorrang = inst?.voorrang || [];
    const WERK = `(t.ai_status = 'nieuw'
            OR (t.ai_status = 'klaar' AND t.ai_versie < $1)
            OR (t.ai_status = 'fout' AND t.ai_beoordeeld_op < now() - interval '6 hours'))`;
    // Volgorde: categorie met voorrang, net door de AI aangevulde titels
    // (die worden meteen gecontroleerd), titels met MP3, iconisch eerst.
    const VOLGORDE = `${bank.voorrangSql('$2')},
            (t.ai_versie = 0 AND t.toevoeg_reden LIKE 'AI-curator%') DESC,
            (t.curatie_status = 'uitgesloten' AND NOT t.ai_uitgesloten),
            ${bank.HEEFT_MP3} DESC, ${bank.TIER_RANG}, t.id`;
    // Eén lijst per categorie: de AI vergelijkt videogames met videogames.
    const { rows: [eerste] } = await pool.query(
        `SELECT COALESCE(t.categorie, t.type::text) AS categorie FROM titels t WHERE ${WERK} ORDER BY ${VOLGORDE} LIMIT 1`,
        [bank.AI_VERSIE, voorrang]);
    if (!eerste) return false;
    const { rows } = await pool.query(`
        SELECT t.id, t.naam, t.type::text AS type, t.jaar, t.land, t.taal::text AS taal, t.categorie, t.handmatig,
               t.nummer_naam, t.nummer_artiest, t.aliassen, t.curatie_status, t.ai_uitgesloten,
               t.bekendheid_tier, t.franchise, t.yt_zoekterm, t.nl_bekend, t.ai_status, t.tmdb_id,
               (SELECT tr.tracknaam FROM tracks tr WHERE tr.titel_id = t.id AND tr.werkt ORDER BY tr.id DESC LIMIT 1) AS tracknaam,
               (SELECT tr.artiest FROM tracks tr WHERE tr.titel_id = t.id AND tr.werkt ORDER BY tr.id DESC LIMIT 1) AS artiest,
               ${bank.HEEFT_MP3} AS heeft_mp3
          FROM titels t
         WHERE ${WERK} AND COALESCE(t.categorie, t.type::text) = $3
         ORDER BY ${VOLGORDE}
         LIMIT $4`, [bank.AI_VERSIE, voorrang, eerste.categorie, BATCH.beoordelen]);
    if (!rows.length) return false;
    zet('beoordelen', `Lijst ${bank.CATEGORIE_LABEL[eerste.categorie] || eerste.categorie} (${rows.length}): ${rows.slice(0, 3).map((r) => r.naam).join(', ')}…`);
    const res = await bankAi.beoordeel(rows);
    if (!res.ok) {
        await pool.query(
            "UPDATE titels SET ai_status = 'fout', ai_beoordeeld_op = now(), ai_notitie = $2 WHERE id = ANY($1)",
            [rows.map((r) => r.id), `AI-fout: ${String(res.error).slice(0, 200)}`],
        );
        controleerAi(res);
    }
    const uitgesloten = [];
    for (const t of rows) {
        const b = res.items.get(t.id);
        if (!b) {
            await pool.query(
                "UPDATE titels SET ai_status = 'fout', ai_beoordeeld_op = now(), ai_notitie = 'AI sloeg deze titel over' WHERE id = $1",
                [t.id]);
            continue;
        }
        const r = await pasBeoordelingToe(t, b);
        if (r.uitgesloten) uitgesloten.push(t.naam);
    }
    status.tellers.beoordeeld += res.items.size;
    status.laatsteActie = `Lijst ${bank.CATEGORIE_LABEL[eerste.categorie] || eerste.categorie}: ${res.items.size} titels beoordeeld${uitgesloten.length ? `, ${uitgesloten.length} uitgesloten` : ''}`;
    await bank.log(null, 'beoordeling', status.laatsteActie
        + (uitgesloten.length ? ` (${uitgesloten.slice(0, 8).join(', ')})` : ''));
    return true;
}

/**
 * Zet een AI-oordeel in de database, met respect voor handmatige velden.
 * De AI-vraag duurt minuten; in de tussentijd kan de beheerder iets
 * aanpassen. Daarom wordt de rij vergrendeld en worden de sloten en status
 * vers gelezen vlak voordat het oordeel wordt weggeschreven.
 */
async function pasBeoordelingToe(oud, b) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: [vers] } = await client.query(
            `SELECT handmatig, curatie_status, ai_uitgesloten, naam, nummer_naam, jaar, aliassen,
                    type::text AS type, categorie, taal::text AS taal
               FROM titels WHERE id = $1 FOR UPDATE`, [oud.id]);
        if (!vers) { await client.query('ROLLBACK'); return { uitgesloten: false }; }
        const r = await pasBeoordelingToeIn(client, { ...oud, ...vers }, b);
        await client.query('COMMIT');
        await logBeoordeling({ ...oud, ...vers }, b, r);
        return r;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.waarschuwing('Beoordeling opslaan mislukt', { id: oud.id, melding: err.message });
        await pool.query("UPDATE titels SET ai_status = 'fout', ai_beoordeeld_op = now(), ai_notitie = $2 WHERE id = $1",
            [oud.id, `Opslaan mislukt: ${err.message.slice(0, 150)}`]);
        return { uitgesloten: false };
    } finally {
        client.release();
    }
}

async function pasBeoordelingToeIn(client, t, b) {
    const vast = (v) => bank.isVast(t, v);
    const zetten = [];
    const waarden = [t.id];
    const set = (kolom, waarde) => { waarden.push(waarde); zetten.push(`${kolom} = $${waarden.length}`); };
    const wijzigingen = [];

    if (!vast('naam') && b.naam && bank.norm(b.naam) !== bank.norm(t.naam)) {
        set('naam', b.naam);
        wijzigingen.push(`naam "${t.naam}" → "${b.naam}"`);
    }
    if (!vast('categorie') && b.categorie) {
        if (b.categorie !== t.categorie) wijzigingen.push(`categorie ${t.categorie || '—'} → ${b.categorie}`);
        set('categorie', b.categorie);
        const type = bank.typeVoorCategorie(b.categorie, t.type);
        if (type !== t.type) {
            waarden.push(type);
            zetten.push(`type = $${waarden.length}::titel_type`);
        }
        set('anime_breed_bekend', b.categorie === 'anime' && b.anime_breed_bekend);
    }
    if (!vast('tier') && b.bekendheid) set('bekendheid_tier', b.bekendheid);
    // Een TMDB-jaartal (releasedatum) is betrouwbaarder dan het AI-jaartal.
    if (!vast('jaar') && b.jaar && !(t.tmdb_id && t.jaar)) set('jaar', b.jaar);
    if (!vast('jaar')) {
        const serie = ['serie', 'anime'].includes(b.categorie || t.categorie) && (b.categorie !== 'anime' || t.type === 'serie');
        set('eind_jaar', serie && !b.serie_lopend ? b.eind_jaar : null);
        set('serie_lopend', serie && b.serie_lopend);
    }
    // Geen "Nederlands" bij The Office: taal en land laten controleren.
    if (!vast('taal')) {
        if (b.taal !== t.taal) {
            waarden.push(b.taal);
            zetten.push(`taal = $${waarden.length}::titel_taal`);
            wijzigingen.push(`taal ${t.taal || '—'} → ${b.taal}`);
        }
        if (b.land) set('land', b.land);
    }
    if (!vast('nl')) { set('nl_bekend', b.nl_bekend); set('nl_reden', b.nl_reden || null); }
    if (!vast('franchise')) set('franchise', b.franchise || null);
    if (!vast('aliassen') && b.aliassen.length) {
        const alle = [...new Set([...(t.aliassen || []), ...b.aliassen])].slice(0, 10);
        set('aliassen', alle);
    }
    let nummerAnders = false;
    if (!vast('nummer')) {
        nummerAnders = bank.norm(b.nummer_naam) !== bank.norm(t.nummer_naam);
        set('nummer_naam', b.nummer_naam || null);
        set('nummer_artiest', b.nummer_artiest || null);
        set('yt_zoekterm', b.yt_zoekterm || null);
    }

    // Uitsluiten of terughalen. De AI raakt alleen uitsluitingen aan die ze
    // zelf heeft gedaan; oude uitsluitingen en handmatige keuzes blijven.
    let uitgesloten = false;
    if (!vast('actief') && !vast('nl')) {
        const weg = b.nl_bekend === 'nee' || !b.geschikt;
        if (weg && t.curatie_status !== 'uitgesloten') {
            set('curatie_status', 'uitgesloten');
            set('ai_uitgesloten', true);
            set('uitsluit_reden', b.nl_bekend === 'nee'
                ? `Niet bekend in Nederland: ${b.nl_reden || 'AI-oordeel'}`
                : `Ongeschikt: ${b.notitie || 'geen herkenbaar nummer'}`);
            uitgesloten = true;
        } else if (!weg && t.ai_uitgesloten) {
            set('curatie_status', 'goedgekeurd');
            set('ai_uitgesloten', false);
            set('uitsluit_reden', null);
            wijzigingen.push('weer opgenomen');
        }
    }

    set('ai_status', 'klaar');
    set('ai_versie', bank.AI_VERSIE);
    zetten.push('ai_beoordeeld_op = now()');
    set('ai_notitie', b.notitie || null);
    if (nummerAnders && !t.heeft_mp3) {
        zetten.push("zoek_status = 'nieuw'", 'zoek_pogingen = 0', 'volgende_poging = NULL');
    }
    await client.query(`UPDATE titels SET ${zetten.join(', ')} WHERE id = $1`, waarden);
    return { uitgesloten, wijzigingen };
}

async function logBeoordeling(t, b, { uitgesloten, wijzigingen = [] }) {
    if (uitgesloten) {
        await bank.log(t.id, 'uitgesloten', `${t.naam} uitgesloten: ${b.nl_bekend === 'nee' ? b.nl_reden : b.notitie}`);
    } else if (wijzigingen.length && t.ai_status !== 'nieuw') {
        await bank.log(t.id, 'beoordeling', `${t.naam}: ${wijzigingen.join(', ')}`);
    } else if (wijzigingen.some((w) => w.startsWith('categorie') || w.startsWith('naam'))) {
        await bank.log(t.id, 'beoordeling', `${t.naam}: ${wijzigingen.join(', ')}`);
    }
}

// ------------------------------------------------------------------
// Stap: hints en bonusvragen
// ------------------------------------------------------------------

async function stapQuiz(inst) {
    const voorrang = inst?.voorrang || [];
    const WERK = "t.ai_status = 'klaar' AND t.curatie_status <> 'uitgesloten' AND t.ai_quiz_op IS NULL";
    const VOLGORDE = `${bank.voorrangSql('$1')}, ${bank.HEEFT_MP3} DESC, ${bank.TIER_RANG}, t.id`;
    const { rows: [eerste] } = await pool.query(
        `SELECT COALESCE(t.categorie, t.type::text) AS categorie FROM titels t WHERE ${WERK} ORDER BY ${VOLGORDE} LIMIT 1`,
        [voorrang]);
    if (!eerste) return false;
    const { rows } = await pool.query(`
        SELECT t.id, t.naam, COALESCE(t.categorie, t.type::text) AS categorie, t.jaar, t.franchise,
               t.aliassen, t.nummer_naam, t.nummer_artiest, t.omschrijving, t.handmatig, t.ai_hints
          FROM titels t
         WHERE ${WERK} AND COALESCE(t.categorie, t.type::text) = $2
         ORDER BY ${VOLGORDE}
         LIMIT $3`, [voorrang, eerste.categorie, BATCH.quiz]);
    if (!rows.length) return false;
    const teDoen = rows.filter((t) => !(bank.isVast(t, 'hints') && bank.isVast(t, 'vragen')));
    if (!teDoen.length) {
        await pool.query('UPDATE titels SET ai_quiz_op = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
        return false;
    }
    zet('quiz', `Hints en vragen: ${teDoen.map((r) => r.naam).join(', ')}`);
    const res = await bankAi.maakQuiz(teDoen);
    controleerAi(res);
    let gelukt = 0;
    for (const t of rows) {
        const q = res.items.get(t.id);
        if (q) {
            await bewaarQuiz(t, q);
            gelukt++;
        }
        await pool.query('UPDATE titels SET ai_quiz_op = now() WHERE id = $1', [t.id]);
    }
    status.tellers.quiz += gelukt;
    status.laatsteActie = `Hints en vragen voor ${gelukt} titels`;
    await bank.log(null, 'quiz', `${status.laatsteActie}: ${teDoen.map((r) => r.naam).join(', ')}`);
    return true;
}

async function bewaarQuiz(oud, q) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Actuele sloten: de beheerder kan tijdens de AI-vraag iets hebben aangepast.
        const { rows: [vers] } = await client.query(
            'SELECT handmatig, ai_hints FROM titels WHERE id = $1 FOR UPDATE', [oud.id]);
        if (!vers) { await client.query('ROLLBACK'); return; }
        const t = { ...oud, ...vers };
        // Nooit een vollere set hints vervangen door een kleinere.
        if (!bank.isVast(t, 'hints') && q.hints.length && q.hints.length >= Math.min(3, (t.ai_hints || []).length)) {
            await client.query(
                "UPDATE titels SET ai_hints = $2, ai_hints_status = 'goedgekeurd' WHERE id = $1",
                [t.id, q.hints]);
        }
        if (!bank.isVast(t, 'vragen') && q.vragen.length) {
            await client.query("DELETE FROM vragen WHERE titel_id = $1 AND soort = 'ai'", [t.id]);
            for (const v of q.vragen) {
                const { opties, correct_index } = bankAi.maakOpties(v);
                await client.query(
                    `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index, ai_review_status)
                     VALUES ($1, 'ai', $2, $3, $4, 'goedgekeurd') ON CONFLICT DO NOTHING`,
                    [t.id, v.vraag, JSON.stringify(opties), correct_index]);
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.waarschuwing('Quiz opslaan mislukt', { id: oud.id, melding: err.message });
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------------
// Stap: MP3 zoeken
// ------------------------------------------------------------------

async function stapMp3(inst) {
    if (ytzoek.rateLimitActief() || bankMp3.gepauzeerd()) return false;
    const bezig = bankMp3.bezigeIds();
    const { rows } = await pool.query(`
        SELECT t.id, t.naam, t.type::text AS type, t.jaar, t.genres, t.taal::text AS taal, t.land, t.talen,
               COALESCE(t.categorie, t.type::text) AS categorie, t.nummer_naam, t.nummer_artiest,
               t.yt_zoekterm, t.mp3_afgekeurd, t.zoek_pogingen, t.handmatig
          FROM titels t
         WHERE t.ai_status = 'klaar' AND t.curatie_status <> 'uitgesloten'
           AND NOT ${bank.HEEFT_MP3}
           AND t.zoek_status IN ('nieuw', 'geen_kandidaat', 'gevonden')
           AND (t.volgende_poging IS NULL OR t.volgende_poging < now())
           AND NOT (t.id = ANY($2::int[]))
         ORDER BY ${bank.voorrangSql('$3')}, ${bank.TIER_RANG}, t.zoek_pogingen, t.id
         LIMIT $1`, [BATCH.mp3, bezig, inst?.voorrang || []]);
    if (!rows.length) return false;
    zet('mp3', `MP3 zoeken: ${rows.map((r) => r.naam).join(', ')}`);
    const r = await bankMp3.verwerkBatch(rows);
    if (r.fout) controleerAi({ ok: false, error: r.fout });
    status.tellers.mp3 += r.gevonden;
    status.laatsteActie = r.blokkade
        ? 'YouTube blokkeert tijdelijk; MP3-zoeken gepauzeerd'
        : `${r.gevonden} van ${rows.length} MP3's gevonden`;
    return r.ai;
}

// ------------------------------------------------------------------
// Stap: aanvullen tot het doelaantal
// ------------------------------------------------------------------

/**
 * Kies categorie, bekendheid en periode voor de volgende aanvulling.
 * Iconisch gaat altijd voor: eerst wordt elke categorie met iconische
 * titels gevuld tot de AI er geen nieuwe meer weet, daarna algemeen
 * bekend, bekend, onbekend en als laatste cult.
 */
function kiesAanvulling(inst, telling) {
    const kandidaten = [];
    for (const c of bank.CATEGORIEEN) {
        const doel = Number(inst.doelen?.[c]) || 0;
        const tekort = doel - telling[c].totaal;
        if (tekort > 0) kandidaten.push({ categorie: c, doel, tekort, ratio: tekort / doel });
    }
    // Categorieën met voorrang eerst, daarna die met het grootste tekort.
    const voorrang = inst.voorrang || [];
    kandidaten.sort((a, b) => (voorrang.includes(b.categorie) - voorrang.includes(a.categorie)) || (b.ratio - a.ratio));
    for (const tier of bank.TIERS) {
        for (const k of kandidaten) {
            const periodes = PERIODES[k.categorie];
            for (let i = 0; i < periodes.length; i++) {
                periodeIndex[k.categorie] = ((periodeIndex[k.categorie] || 0) + 1) % periodes.length;
                const periode = periodes[periodeIndex[k.categorie]];
                if ((uitgeput[`${k.categorie}|${periode}|${tier}`] || 0) < Date.now()) {
                    return { ...k, tier, periode };
                }
            }
        }
    }
    return null;
}

async function stapAanvullen(inst) {
    const telling = await bank.tellingen();
    const keuze = kiesAanvulling(inst, telling);
    if (!keuze) return false;
    const { categorie, tier, periode } = keuze;

    const [van, tot] = periode ? periode.split('-') : [null, null];
    const params = [categorie];
    let jaarFilter = '';
    if (van) {
        params.push(Number(van) - 1, tot === 'nu' ? 2100 : Number(tot) + 1);
        jaarFilter = 'AND (t.jaar IS NULL OR t.jaar BETWEEN $2 AND $3)';
    }
    const { rows: bestaandRows } = await pool.query(
        `SELECT DISTINCT t.naam FROM titels t WHERE COALESCE(t.categorie, t.type::text) = $1 ${jaarFilter}
         ORDER BY 1 LIMIT 2500`, params);
    const { rows: alleRows } = await pool.query(
        `SELECT t.naam FROM titels t WHERE COALESCE(t.categorie, t.type::text) = $1`, [categorie]);
    const namen = new Set(alleRows.map((r) => bank.norm(r.naam)));

    const aantal = Math.min(BATCH.aanvullen, keuze.tekort);
    zet('aanvullen', `Lijst maken: ${aantal} ${bank.CATEGORIE_LABEL[categorie]} (${periode || 'alle jaren'}, ${bank.TIER_LABEL[tier]})`);
    const res = await bankAi.vulAan({ categorie, aantal, periode, tier, bestaand: bestaandRows.map((r) => r.naam) });
    controleerAi(res);

    let toegevoegd = 0;
    let passend = 0; // nieuwe titels van precies de gevraagde bekendheid
    const nieuweNamen = [];
    for (const it of res.items) {
        const sleutel = bank.norm(it.naam);
        if (!sleutel || namen.has(sleutel)) continue;
        namen.add(sleutel);
        // Alleen naam/jaar/inschatting opslaan; de beoordelingsronde
        // controleert direct daarna (als lijst) NL-bekendheid, gegevens,
        // categorie en het herkenningsnummer.
        const muziek = bank.MUZIEK_CATEGORIEEN.has(categorie);
        try {
            await pool.query(
                `INSERT INTO titels (naam, type, taal, jaar, categorie, bekendheid_tier, nummer_naam, nummer_artiest,
                        ai_status, ai_versie, curatie_status, toevoeg_reden, genres, muziek_genres)
                 VALUES ($1, $2::titel_type, 'en', $3, $4, $5, $6, $7, 'nieuw', 0, 'goedgekeurd', $8, $9, $9)`,
                [it.naam, bank.typeVoorCategorie(categorie, categorie === 'anime' ? 'serie' : 'film'), it.jaar,
                    categorie, it.bekendheid || tier, muziek ? it.naam : null, muziek ? (it.artiest || null) : null,
                    `AI-curator: aangevuld (${bank.CATEGORIE_LABEL[categorie]}, ${periode || 'alle jaren'})`,
                    categorie === 'game' ? ['Videogames'] : categorie === 'kerst' ? ['Kerst'] : []],
            );
            toegevoegd++;
            if (!it.bekendheid || it.bekendheid === tier) passend++;
            nieuweNamen.push(`${it.naam}${it.bekendheid ? ` (${bank.TIER_LABEL[it.bekendheid]})` : ''}`);
        } catch (err) {
            logger.waarschuwing('Aanvulling opslaan mislukt', { naam: it.naam, melding: err.message });
        }
    }
    // Weet de AI in deze hoek bijna niets nieuws meer, dan drie dagen overslaan
    // en door naar de volgende periode/categorie/bekendheid.
    if (passend < 3) uitgeput[`${categorie}|${periode}|${tier}`] = Date.now() + 3 * 24 * 3600 * 1000;
    status.tellers.toegevoegd += toegevoegd;
    status.laatsteActie = `${bank.CATEGORIE_LABEL[categorie]}: ${toegevoegd} nieuwe titels op de lijst (worden direct gecontroleerd)`;
    await bank.log(null, 'aanvulling', `${status.laatsteActie}${nieuweNamen.length ? `: ${nieuweNamen.join(', ')}` : ''}`);
    return true;
}

// ------------------------------------------------------------------
// Stap: verbeterpunten
// ------------------------------------------------------------------

async function verbeterMeldingen() {
    const { rows } = await pool.query(`
        SELECT m.titel_id, array_agg(m.id) AS ids, array_agg(DISTINCT m.soort) AS soorten,
               string_agg(DISTINCT COALESCE(m.toelichting, ''), '; ') AS toelichting, t.naam, t.handmatig
          FROM meldingen m JOIN titels t ON t.id = m.titel_id
         WHERE m.afgehandeld = false AND m.soort IN ('verkeerd_nummer', 'geen_geluid', 'geen_track')
         GROUP BY m.titel_id, t.naam, t.handmatig
         LIMIT 20`);
    for (const r of rows) {
        if (!(r.soorten.length === 1 && r.soorten[0] === 'geen_track')) {
            // Een eigen link van de beheerder keuren we niet zomaar af.
            if (bank.isVast(r, 'mp3')) {
                await bank.log(r.titel_id, 'verbeterpunt', `${r.naam}: melding (${r.soorten.join(', ')}) op een handmatig gekozen MP3 — controleer zelf.`);
                await pool.query('UPDATE meldingen SET afgehandeld = true WHERE id = ANY($1)', [r.ids]);
                continue;
            }
            await bankMp3.keurAf(r.titel_id, `Spelermelding: ${r.soorten.join(', ')}${r.toelichting ? ` (${r.toelichting.slice(0, 120)})` : ''}`);
        } else {
            await bankMp3.zoekOpnieuw(r.titel_id);
        }
        await pool.query('UPDATE meldingen SET afgehandeld = true WHERE id = ANY($1)', [r.ids]);
        await bank.log(r.titel_id, 'verbeterpunt', `${r.naam}: spelermelding afgehandeld, AI zoekt een nieuwe MP3.`);
        status.tellers.verbeterd++;
    }
    return false;
}

async function verbeterDubbelen() {
    const { rows } = await pool.query(`
        WITH g AS (
          SELECT t.id, t.naam, COALESCE(t.categorie, t.type::text) AS cat, t.handmatig,
                 lower(regexp_replace(t.naam, '[^[:alnum:]]+', '', 'g')) AS sleutel,
                 ${bank.HEEFT_MP3} AS mp3, ${bank.TIER_RANG} AS rang
            FROM titels t WHERE t.curatie_status <> 'uitgesloten'
        ), r AS (
          SELECT g.*, row_number() OVER (PARTITION BY cat, sleutel ORDER BY mp3 DESC, rang, id) AS nr,
                 first_value(id) OVER (PARTITION BY cat, sleutel ORDER BY mp3 DESC, rang, id) AS houden
            FROM g WHERE sleutel <> ''
        )
        SELECT id, naam, houden, handmatig FROM r WHERE nr > 1 LIMIT 50`);
    for (const d of rows) {
        if (bank.isVast(d, 'actief')) continue;
        await pool.query(
            `UPDATE titels SET curatie_status = 'uitgesloten', ai_uitgesloten = true, uitsluit_reden = $2 WHERE id = $1`,
            [d.id, `Dubbel van #${d.houden}`]);
        await bank.log(d.id, 'verbeterpunt', `${d.naam}: dubbel van #${d.houden}, uitgesloten.`);
        status.tellers.verbeterd++;
    }
    return false;
}

async function verbeterQuizGaten() {
    const { rowCount } = await pool.query(`
        UPDATE titels t SET ai_quiz_op = NULL
         WHERE t.ai_quiz_op < now() - interval '7 days' AND t.curatie_status <> 'uitgesloten'
           AND NOT ('hints' = ANY(t.handmatig) AND 'vragen' = ANY(t.handmatig))
           AND (COALESCE(array_length(t.ai_hints, 1), 0) < 3
                OR (SELECT count(*) FROM vragen v WHERE v.titel_id = t.id AND v.ai_review_status <> 'afgekeurd') < 3)`);
    if (rowCount) await bank.log(null, 'verbeterpunt', `${rowCount} titels zonder volledige hints/vragen opnieuw in de wachtrij.`);
    await pool.query("DELETE FROM bank_log WHERE aangemaakt_op < now() - interval '30 days'");
    // Elke 60 dagen alles opnieuw laten beoordelen (kennis en bekendheid veranderen).
    await pool.query(`UPDATE titels SET ai_status = 'nieuw'
         WHERE ai_status = 'klaar' AND ai_beoordeeld_op < now() - interval '60 days'`);
    return false;
}

async function verbeterMp3Controle() {
    const { rows } = await pool.query(`
        SELECT DISTINCT ON (t.id) tr.id AS track_id, t.id, t.naam, COALESCE(t.categorie, t.type::text) AS categorie,
               t.nummer_naam, t.nummer_artiest, tr.youtube_titel, tr.tracknaam, tr.artiest, tr.bron_url
          FROM titels t JOIN tracks tr ON tr.titel_id = t.id
         WHERE t.ai_status = 'klaar' AND t.curatie_status <> 'uitgesloten'
           AND NOT ('mp3' = ANY(t.handmatig))
           AND tr.werkt = true AND tr.bron = 'lokaal' AND tr.download_status = 'available'
           AND tr.review_handmatig = false
           AND COALESCE(tr.verificatie_reden, '') NOT LIKE 'AI-%'
         ORDER BY t.id, tr.id DESC
         LIMIT 10`);
    if (!rows.length) return false;
    zet('verbeteren', `Bestaande MP3's controleren: ${rows.slice(0, 3).map((r) => r.naam).join(', ')}…`);
    const res = await bankAi.controleerTracks(rows);
    controleerAi(res);
    let fout = 0;
    for (const r of rows) {
        const o = res.items.get(r.track_id);
        if (!o) continue;
        if (o.oordeel === 'fout') {
            await bankMp3.keurAf(r.id, `AI-controle: ${o.reden}`);
            fout++;
        } else {
            await pool.query(
                `UPDATE tracks SET verificatie_reden = $2, laatst_gecontroleerd_op = now(),
                        review_status = CASE WHEN $3 THEN 'goedgekeurd' ELSE review_status END WHERE id = $1`,
                [r.track_id, `AI-gecontroleerd (${o.oordeel}): ${o.reden}`.slice(0, 400), o.oordeel === 'goed']);
        }
    }
    status.tellers.verbeterd += fout;
    status.laatsteActie = `${rows.length} bestaande MP3's gecontroleerd, ${fout} afgekeurd`;
    await bank.log(null, 'verbeterpunt', status.laatsteActie);
    return true;
}

async function verbeterAudit() {
    const { rows } = await pool.query(`
        SELECT t.id, t.naam, t.categorie, t.bekendheid_tier, t.nl_bekend, t.jaar, t.franchise,
               t.nummer_naam, t.nummer_artiest, t.handmatig, t.type::text AS type, t.curatie_status, t.ai_uitgesloten,
               t.tmdb_id
          FROM titels t
         WHERE t.ai_status = 'klaar' AND t.curatie_status <> 'uitgesloten'
         ORDER BY t.ai_beoordeeld_op NULLS FIRST, random()
         LIMIT 20`);
    if (!rows.length) return false;
    zet('verbeteren', `Steekproef nalopen: ${rows.length} titels`);
    const res = await bankAi.audit(rows);
    controleerAi(res);
    const perId = new Map(rows.map((r) => [r.id, r]));
    const kolom = {
        naam: 'naam', categorie: 'categorie', bekendheid: 'bekendheid_tier', nl_bekend: 'nl_bekend',
        jaar: 'jaar', franchise: 'franchise', nummer_naam: 'nummer_naam', nummer_artiest: 'nummer_artiest',
    };
    const slot = {
        naam: 'naam', categorie: 'categorie', bekendheid: 'tier', nl_bekend: 'nl', jaar: 'jaar',
        franchise: 'franchise', nummer_naam: 'nummer', nummer_artiest: 'nummer',
    };
    let toegepast = 0;
    for (const c of res.correcties) {
        const t = perId.get(c.id);
        if (!t || bank.isVast(t, slot[c.veld])) continue;
        let waarde = c.waarde;
        if (c.veld === 'jaar') {
            waarde = parseInt(waarde, 10);
            if (!(waarde > 1900 && waarde <= new Date().getFullYear() + 1)) continue;
            if (t.tmdb_id && t.jaar) continue; // TMDB-releasejaar wint
        }
        if (c.veld === 'categorie' && !bank.CATEGORIEEN.includes(waarde)) continue;
        if (c.veld === 'bekendheid' && !bank.TIERS.includes(waarde)) continue;
        if (c.veld === 'nl_bekend' && !['ja', 'nee', 'twijfel'].includes(waarde)) continue;
        if (!String(waarde ?? '').trim()) continue;
        // Slot opnieuw in de UPDATE zelf: een handmatige wijziging tijdens de
        // AI-vraag wint altijd.
        const { rowCount } = await pool.query(
            `UPDATE titels SET ${kolom[c.veld]} = $2 WHERE id = $1 AND NOT ($3 = ANY(handmatig))`,
            [t.id, waarde, slot[c.veld]]);
        if (!rowCount) continue;
        if (c.veld === 'categorie') {
            await pool.query('UPDATE titels SET type = $2::titel_type WHERE id = $1', [t.id, bank.typeVoorCategorie(waarde, t.type)]);
        }
        if (c.veld === 'nl_bekend' && waarde === 'nee') {
            await pool.query(`UPDATE titels SET curatie_status = 'uitgesloten', ai_uitgesloten = true,
                uitsluit_reden = $2 WHERE id = $1 AND NOT ('actief' = ANY(handmatig))`, [t.id, `Niet bekend in Nederland: ${c.reden}`]);
        }
        if (c.veld === 'nummer_naam') {
            await pool.query(`UPDATE titels SET yt_zoekterm = NULL WHERE id = $1`, [t.id]);
        }
        await bank.log(t.id, 'verbeterpunt', `${t.naam}: ${c.veld} → ${waarde} (${c.reden})`);
        toegepast++;
    }
    await pool.query('UPDATE titels SET ai_beoordeeld_op = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    status.tellers.verbeterd += toegepast;
    status.laatsteActie = `Steekproef van ${rows.length}: ${toegepast} verbeteringen`;
    await bank.log(null, 'verbeterpunt', status.laatsteActie);
    return true;
}

async function stapVerbeteren() {
    if (Date.now() - laatsteVerbeter < 15 * 60 * 1000) return false;
    laatsteVerbeter = Date.now();
    zet('verbeteren', 'Meldingen, dubbelen en hiaten nalopen');
    await verbeterMeldingen();
    await verbeterDubbelen();
    await verbeterQuizGaten();
    // Afwisselend: bestaande MP3's controleren of een steekproef nalopen.
    const ai = verbeterIndex++ % 2 === 0 ? verbeterMp3Controle : verbeterAudit;
    return ai();
}

const STAPPEN = {
    beoordelen: stapBeoordelen,
    mp3: stapMp3,
    quiz: stapQuiz,
    aanvullen: stapAanvullen,
    verbeteren: stapVerbeteren,
};

// ------------------------------------------------------------------
// De lus
// ------------------------------------------------------------------

async function lus() {
    let leeg = 0;
    for (;;) {
        let inst;
        try {
            inst = await bank.instellingen();
        } catch (err) {
            zet('fout', `Database niet bereikbaar: ${err.message}`);
            await slaap(30000);
            continue;
        }
        if (!inst.aan) { zet('uit', 'De AI-curator staat uit.'); await slaap(30000); continue; }
        if (Date.now() < status.pauzeTot) { await slaap(Math.min(60000, status.pauzeTot - Date.now())); continue; }

        const login = await codex.loginStatus().catch(() => ({ loggedIn: false }));
        if (!login.loggedIn) {
            zet('wacht', 'ChatGPT is niet gekoppeld. Koppel ChatGPT in het overzicht.');
            await slaap(60000);
            continue;
        }

        const stap = CYCLUS[cyclusIndex++ % CYCLUS.length];
        let deedAi = false;
        try {
            deedAi = await STAPPEN[stap](inst);
            status.laatsteFout = null;
        } catch (err) {
            if (err instanceof AiFout && err.limiet) {
                status.pauzeTot = Date.now() + 30 * 60 * 1000;
                zet('pauze', 'Limiet van het ChatGPT-abonnement bereikt; over 30 minuten verder.');
                await bank.log(null, 'systeem', 'ChatGPT-limiet bereikt, 30 minuten pauze.');
                continue;
            }
            if (err instanceof AiFout && err.login) { zet('wacht', err.message); await slaap(60000); continue; }
            status.laatsteFout = `${stap}: ${err.message}`;
            logger.waarschuwing('AI-curator stap mislukt', { stap, melding: err.message });
            await bank.log(null, 'fout', `Stap ${stap} mislukt: ${err.message}`);
            deedAi = true; // wel even pauzeren
        }
        if (deedAi) {
            leeg = 0;
            zet('pauze', `Volgende stap over ${inst.pauzeSeconden} s`);
            await slaap(inst.pauzeSeconden * 1000);
        } else if (++leeg >= CYCLUS.length) {
            leeg = 0;
            zet('klaar', 'Alles is bijgewerkt. Over 5 minuten opnieuw kijken.');
            await slaap(5 * 60 * 1000);
        }
    }
}

function start() {
    if (status.gestart || process.env.AI_CURATOR === 'false') return;
    status.gestart = true;
    setTimeout(() => {
        lus().catch((err) => {
            logger.fout('AI-curator gestopt', { melding: err.message });
            status.gestart = false;
            zet('fout', `Gestopt: ${err.message}`);
        });
    }, 10000).unref?.();
}

function huidigeStatus() {
    return { ...status, tellers: { ...status.tellers }, mp3Bezig: bankMp3.bezigeIds().length };
}

module.exports = { start, porren, huidigeStatus, pasBeoordelingToe, bewaarQuiz };
