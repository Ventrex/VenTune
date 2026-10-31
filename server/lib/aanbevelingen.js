// =====================================================================
// Aanbevelingen via ChatGPT (Codex) — draagt kandidaten aan die de
// beheerder daarna Tinder-stijl goed/fout/weet-niet swipet.
//
// Twee soorten:
//   'film_serie' — bekende films/series met een algemeen bekend thema/lied
//                  dat er echt bij hoort (bv. The Office-theme, Terminator).
//   'kerst'      — algemeen bekende kerstliedjes (zanger + nummer + jaar).
//
// Harde eis in de prompt: alleen titels met een goede fanbase, geen
// obscure dingen; en alleen nummers die echt bij de titel horen.
// =====================================================================

const codex = require('./codex');
const { pool } = require('../db/pool');
const logger = require('./logger');

// -------------------- JSON-schema's voor Codex --------------------

const SCHEMA_FILM_SERIE = {
    type: 'object',
    additionalProperties: false,
    required: ['kandidaten'],
    properties: {
        kandidaten: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['titel', 'type', 'jaar', 'genres', 'tracknaam', 'artiest',
                           'themas', 'studio', 'muziek_genres', 'muziek_type', 'omschrijving', 'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    titel: { type: 'string' },
                    type: { type: 'string', enum: ['film', 'serie'] },
                    jaar: { type: 'integer' },
                    genres: { type: 'array', items: { type: 'string' } },
                    themas: { type: 'array', items: { type: 'string' } },
                    studio: { type: ['string', 'null'] },
                    muziek_genres: { type: 'array', items: { type: 'string' } },
                    muziek_type: { type: 'string', enum: ['intro', 'thema', 'soundtrack'] },
                    omschrijving: { type: 'string' },
                    tracknaam: { type: 'string' },
                    artiest: { type: 'string' },
                    youtube_zoekterm: { type: 'string' },
                    // 1..5: hoe algemeen bekend de titel én het nummer zijn.
                    bekendheid: { type: 'integer', minimum: 1, maximum: 5 },
                    reden: { type: 'string' },
                },
            },
        },
    },
};

const SCHEMA_KERST = {
    type: 'object',
    additionalProperties: false,
    required: ['kandidaten'],
    properties: {
        kandidaten: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['tracknaam', 'artiest', 'jaar', 'muziek_genres', 'youtube_zoekterm', 'bekendheid', 'reden'],
                properties: {
                    tracknaam: { type: 'string' },
                    artiest: { type: 'string' },
                    jaar: { type: 'integer' },
                    muziek_genres: { type: 'array', items: { type: 'string' } },
                    youtube_zoekterm: { type: 'string' },
                    bekendheid: { type: 'integer', minimum: 1, maximum: 5 },
                    reden: { type: 'string' },
                },
            },
        },
    },
};

const CATEGORIEEN = ['film', 'serie', 'disney', 'kerst', 'rock', '80s', '90s', '20s', 'kinder', '100nl'];
const OMSCHRIJVING = {
    disney: 'bekende originele Disney-film- of seriemuziek en Disney-liedjes',
    rock: 'bekende rockmuziek (echte rocknummers)',
    '80s': 'bekende muziekhits uitgebracht tussen 1980 en 1989',
    '90s': 'bekende muziekhits uitgebracht tussen 1990 en 1999',
    '20s': 'bekende muziekhits uitgebracht vanaf 2020 tot en met het huidige jaar (geen toekomstige releases)',
    kinder: 'bekende kinderliedjes voor Nederlandse gezinnen',
    '100nl': 'bekende Nederlandstalige liedjes van artiesten uit Nederland; geen Vlaamse artiesten tenzij zij zelf uit Nederland afkomstig zijn',
};
function promptMuziek({ categorie, aantal, bestaand }) {
    const onderwerp = OMSCHRIJVING[categorie] || 'bekende muziekhits';
    const uitsluiten = bestaand.length ? `\nSla deze reeds bekende artiest-titelcombinaties over:\n- ${bestaand.slice(-250).join('\n- ')}` : '';
    return `Stel voor een muziekquiz ${aantal} unieke, breed herkenbare nummers samen in de categorie ${categorie}: ${onderwerp}.
Geef in kandidaten de exacte tracknaam, artiest, het oorspronkelijke releasejaar van die uitvoering, muziek_genres, youtube_zoekterm, bekendheid (3..5) en een korte reden.
Kies uitsluitend nummers die aantoonbaar tot de categorie behoren. Wees precies met releasejaren en artiesten. Geen covers verwarren met originele versies.
Gebruik jouw kennis en zoek waar nodig ter verificatie; verzin niets.\nVoor 100nl: geef bij elk nummer herkomst_land = Nederland, Anders of Onbekend op basis van de afkomst van de uitvoerende artiest.${uitsluiten}`;
}

// Voor 100% NL verplicht de AI de herkomst van de uitvoerende artiest te vermelden.
const SCHEMA_100NL = {
    ...SCHEMA_KERST,
    properties: {
        kandidaten: {
            ...SCHEMA_KERST.properties.kandidaten,
            items: {
                ...SCHEMA_KERST.properties.kandidaten.items,
                required: [...SCHEMA_KERST.properties.kandidaten.items.required, 'herkomst_land'],
                properties: {
                    ...SCHEMA_KERST.properties.kandidaten.items.properties,
                    herkomst_land: { type: 'string', enum: ['Nederland', 'Anders', 'Onbekend'] },
                },
            },
        },
    },
};

// -------------------------- prompts --------------------------

function promptFilmSerie({ aantal, taal, bestaand }) {
    const taalregel = taal === 'nl'
        ? 'Kies vooral Nederlandse films en series (bv. Zwartboek, Flodder, Undercover, Gooische Vrouwen) en internationaal zeer bekende titels die Nederlanders kennen.'
        : taal === 'en'
            ? 'Kies internationaal zeer bekende Engelstalige films en series.'
            : 'Kies een mix van bekende Nederlandse titels en internationaal zeer bekende titels die Nederlanders kennen.';
    const uitsluiten = (bestaand && bestaand.length)
        ? `\n\nDeze titels zitten al in de database, sla ze over:\n- ${bestaand.slice(0, 200).join('\n- ')}`
        : '';
    return `Je helpt een muziekquiz over films en series (zoals Hitster) vullen.

Geef maximaal ${aantal} verschillende kandidaten (een lege lijst is toegestaan als je geen overtuigende bekende titels meer kent): elk een bekende film of serie met de ORIGINELE SOUNDTRACK — de officiële theme song, titelmuziek of het iconische herkenningsnummer dat echt bij die film/serie hoort. Denk aan: de titelmuziek van The Office, het thema van CSI (Who Are You - The Who), de titelsong van Friends (I'll Be There For You), het thema van Terminator.

Harde eisen:
- Alleen films/series met een GOEDE FANBASE. Geen obscure of nauwelijks bekende titels. Verzin GEEN titels om een gewenst aantal te bereiken.
- Geef uitsluitend titels die NIET in de uitsluitlijst staan. Gebruik alternatieven als een titel al bestaat.
- Een herkenbare intro, officiële titelmuziek of iconische soundtrack is toegestaan; geef geen niet-gerelateerde nummers.
- Gebruik jouw kennis om een lijst samen te stellen. Zoek zo nodig online ter verificatie, maar geef ook zonder gevonden webresultaten de beste feitelijke kandidaten terug.
- Het nummer moet de ECHTE, originele soundtrack/titelmuziek zijn — niet een willekeurig liedje of een cover.
- Geef, als het een bestaand lied is, de echte artiest; is het instrumentale titelmuziek, geef dan de componist of "Titelmuziek".
- Vul 'bekendheid' 1..5: 5 = vrijwel iedereen herkent het meteen, 1 = alleen fans. Geef niets onder de 3.
- 'youtube_zoekterm': waarmee je de originele soundtrack op YouTube vindt (bv. "The Office theme song", "CSI Who Are You theme").
- Geef genres van de film/serie (bv. Actie, Komedie), themas (bv. Superhelden, Kerst, Disney), studio/uitgever (bv. Disney, Warner Bros., Netflix) of null indien onbekend.
- Geef de muziek_genres van het daadwerkelijke nummer (bv. Rock, Pop, Orkestraal) en muziek_type: intro, thema of soundtrack.
- 'omschrijving': één of twee feitelijke zinnen waar de film of serie over gaat, zonder spoilers.
- 'reden': één korte zin waarom dit het herkenningsnummer van die titel is.
${taalregel}${uitsluiten}`;
}

function promptKerst({ aantal, bestaand }) {
    const uitsluiten = (bestaand && bestaand.length)
        ? `\n\nDeze nummers zitten al in de database, sla ze over:\n- ${bestaand.slice(0, 200).join('\n- ')}`
        : '';
    return `Je helpt een kerstmuziek-quiz vullen. In het spel moeten spelers de zanger, het nummer en het jaartal raden.

Geef ${aantal} VERSCHILLENDE kandidaten voor een top 100 van algemeen bekende kerstliedjes die vrijwel iedereen kent (bv. de grote kersthits die elk jaar overal klinken).

Harde eisen:
- Alleen ECHT BEKENDE kerstliedjes met een brede fanbase. Geen obscure nummers.
- Sla alle nummers uit de uitsluitlijst over, kies andere bekende nummers.
- Gebruik jouw kennis om de top samen te stellen en verifieer jaartallen zo nodig via web search; geef nooit een lege lijst puur omdat online zoeken niets opleverde.
- Het jaar is het oorspronkelijke uitgavejaar van de genoemde uitvoering (niet het jaar waarin de compositie is geschreven).
- Geef het jaar van de originele/bekendste uitgave zo nauwkeurig mogelijk.
- Vul 'bekendheid' 1..5: 5 = iedereen kent het, 1 = alleen liefhebbers. Geef niets onder de 3.
- 'youtube_zoekterm': waarmee je het nummer op YouTube vindt (bv. "Wham Last Christmas").
- Vermeld muziek_genres (bv. Pop, Rock, Jazz of Klassiek) voor toekomstige genreselecties.
- 'reden': één korte zin.
- Mix Engelstalige en Nederlandstalige kersthits.${uitsluiten}`;
}

// ----------------------- hoofdfunctie -----------------------

/** Bestaande titel-/tracknamen om dubbele aanbevelingen te voorkomen. */
async function bestaandeNamen(soort) {
    if (soort !== 'film_serie') {
        const { rows } = await pool.query(
            `SELECT DISTINCT lower(tracknaam || ' - ' || artiest) AS n FROM aanbevelingen WHERE soort IN ('kerst', 'muziek')
             UNION SELECT DISTINCT lower(tracknaam || ' - ' || artiest) FROM tracks`);
        return rows.map((r) => r.n).filter(Boolean);
    }
    const { rows } = await pool.query(
        `SELECT DISTINCT lower(titel) AS n FROM aanbevelingen WHERE soort='film_serie'
         UNION SELECT DISTINCT lower(naam) FROM titels`);
    return rows.map((r) => r.n).filter(Boolean);
}

/**
 * Genereer kandidaten via ChatGPT en bewaar ze als 'nieuw' (wachten op swipe).
 * @param {{soort:'film_serie'|'kerst', aantal?:number, taal?:string, minBekendheid?:number, signal?:AbortSignal}} opties
 * @returns {Promise<{ok:boolean, toegevoegd?:number, overgeslagen?:number, error?:string}>}
 */
async function genereer(opties) {
    const categorie = CATEGORIEEN.includes(opties.categorie) ? opties.categorie : (opties.soort === 'kerst' ? 'kerst' : 'film');
    const soort = categorie === 'kerst' ? 'kerst' : (categorie === 'film' || categorie === 'serie' ? 'film_serie' : 'muziek');
    const aantal = Math.min(100, Math.max(1, opties.aantal || (100)));
    const minBek = opties.minBekendheid || 3;

    const bestaand = await bestaandeNamen(soort);
    const bestaandeSet = new Set(bestaand.map((n) => String(n).trim().toLowerCase()));

    const schema = categorie === '100nl' ? SCHEMA_100NL : soort === 'film_serie' ? SCHEMA_FILM_SERIE : SCHEMA_KERST;

    // Grote kerstlijsten in kleine batches opvragen: betrouwbaarder dan 100 items in één AI-antwoord.
    const lijst = [];
    const batchSize = soort !== 'film_serie' ? 20 : 15;
    const aantalBatches = Math.ceil(aantal / batchSize);
    let legeOfDubbeleBatches = 0;
    for (let i = 0; i < aantalBatches; i++) {
        const nodig = Math.min(batchSize, aantal - lijst.length);
        if (nodig <= 0) break;
        const aanvullend = lijst.map((k) => soort !== 'film_serie' ? `${k.tracknaam} - ${k.artiest}` : k.titel).filter(Boolean);
        const batchPrompt = categorie === 'kerst'
            ? promptKerst({ aantal: nodig, bestaand: [...bestaand, ...aanvullend] })
            : soort === 'muziek'
                ? promptMuziek({ categorie, aantal: nodig, bestaand: [...bestaand, ...aanvullend] })
                : promptFilmSerie({ aantal: nodig, taal: opties.taal || 'beide', bestaand: [...bestaand, ...aanvullend] })
                    + `\nBELANGRIJK: geef uitsluitend ${categorie === 'film' ? 'films' : 'series'} terug (type moet ${categorie} zijn).`;
        const res = await codex.vraagJson({ prompt: batchPrompt, schema, signal: opties.signal });
        if (!res.ok) {
            if (!lijst.length) return { ok: false, error: res.error };
            logger.waarschuwing('Aanbevelingen batch mislukt', { batch: i + 1, melding: res.error });
            break;
        }
        const voorBatch = lijst.length;
        const ontvangen = Array.isArray(res.data?.kandidaten) ? res.data.kandidaten : [];
        for (const k of ontvangen) {
            if (!k || (soort === 'film_serie' && k.type !== categorie) || (categorie === '100nl' && k.herkomst_land !== 'Nederland')) continue;
            const sleutel = soort !== 'film_serie' ? `${k.tracknaam || ''} - ${k.artiest || ''}` : k.titel || '';
            const genormaliseerd = sleutel.trim().toLowerCase();
            if (!genormaliseerd || bestaandeSet.has(genormaliseerd)) continue;
            bestaandeSet.add(genormaliseerd);
            lijst.push(k);
        }
        // Als de AI vrijwel niets nieuws meer weet, voorkom eindeloos
        // varianten/dubbelen opvragen om een arbitrair doel te halen.
        if (lijst.length === voorBatch) legeOfDubbeleBatches++; else legeOfDubbeleBatches = 0;
        if (!ontvangen.length || legeOfDubbeleBatches >= 2) {
            logger.info('Generatie gestopt: onvoldoende nieuwe betrouwbare kandidaten', { categorie, batch: i + 1 });
            break;
        }
    }
    if (!lijst.length) {
        return { ok: false, error: 'ChatGPT heeft geen kandidaten teruggegeven. Er is niets toegevoegd.' };
    }
    let toegevoegd = 0;
    let overgeslagen = 0;
    let opslagFouten = 0;
    let eersteOpslagFout = '';

    for (const k of lijst) {
        if (!k || (k.bekendheid || 0) < minBek) { overgeslagen++; continue; }
        try {
            const r = await pool.query(
                `INSERT INTO aanbevelingen
                    (soort, titel, type, jaar, genres, tracknaam, artiest,
                     youtube_zoekterm, bekendheid, reden, themas, studio, muziek_genres, muziek_type, categorie, omschrijving, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'nieuw')
                 ON CONFLICT DO NOTHING RETURNING id`,
                [
                    soort,
                    k.titel || null,
                    k.type || null,
                    Number.isFinite(k.jaar) ? k.jaar : null,
                    Array.isArray(k.genres) ? k.genres : [],
                    k.tracknaam || '',
                    k.artiest || '',
                    k.youtube_zoekterm || '',
                    k.bekendheid || minBek,
                    k.reden || null,
                    Array.isArray(k.themas) ? k.themas : [],
                    k.studio || null,
                    Array.isArray(k.muziek_genres) ? k.muziek_genres : [],
                    k.muziek_type || null,
                    categorie,
                    k.omschrijving || null,
                ],
            );
            if (r.rows[0]) toegevoegd++; else overgeslagen++;
        } catch (err) {
            logger.waarschuwing('Aanbeveling niet opgeslagen', { melding: err.message });
            opslagFouten++;
            if (!eersteOpslagFout) eersteOpslagFout = err.message;
            overgeslagen++;
        }
    }

    logger.info('Aanbevelingen gegenereerd', { soort, ontvangen: lijst.length, toegevoegd, overgeslagen, opslagFouten });
    if (toegevoegd === 0) {
        const reden = opslagFouten
            ? `Opslaan mislukt (${opslagFouten} databasefouten). Eerste fout: ${eersteOpslagFout}`
            : `Geen nieuwe nummers toegevoegd: ${overgeslagen} kandidaat/kandidaten afgekeurd of al aanwezig.`;
        return { ok: false, error: reden };
    }
    return { ok: true, toegevoegd, overgeslagen };
}

const SCHEMA_CORRECTIE = {
    type: 'object', additionalProperties: false, required: ['tracknaam', 'artiest', 'youtube_zoekterm', 'reden'],
    properties: {
        tracknaam: { type: 'string' },
        artiest: { type: 'string' },
        youtube_zoekterm: { type: 'string' },
        reden: { type: 'string' },
    },
};

/**
 * Herzoek de nummers die als 'fout' zijn gemarkeerd: vraag ChatGPT om het
 * JUISTE herkenningsnummer en zet ze terug naar 'nieuw' (ronde 1).
 * @returns {Promise<{ok:boolean, hersteld?:number, error?:string}>}
 */
async function herzoekFout({ limiet = 10 } = {}) {
    const { rows } = await pool.query(
        `SELECT * FROM aanbevelingen WHERE status = 'fout' AND soort = 'film_serie'
         ORDER BY aangemaakt_op LIMIT $1`, [limiet]);
    if (!rows.length) return { ok: true, hersteld: 0 };

    let hersteld = 0;
    for (const a of rows) {
        const prompt = `Het herkenningsnummer "${a.tracknaam}" van ${a.artiest} bleek NIET het juiste nummer voor ${a.type} "${a.titel}"${a.jaar ? ` (${a.jaar})` : ''}.

Wat is wél de originele, algemeen bekende soundtrack / titelmuziek / het herkenningsnummer van deze ${a.type}? Geef het juiste nummer, de artiest (of componist / "Titelmuziek"), en een YouTube-zoekterm. Verzin niets: baseer je op web search.`;
        const res = await codex.vraagJson({ prompt, schema: SCHEMA_CORRECTIE });
        if (!res.ok) continue;
        const d = res.data || {};
        if (!d.tracknaam) continue;
        await pool.query(
            `UPDATE aanbevelingen SET tracknaam = $2, artiest = $3, youtube_zoekterm = $4,
                    reden = COALESCE($5, reden), status = 'nieuw', voorbeeld_bron = NULL,
                    beoordeeld_op = NULL
             WHERE id = $1`,
            [a.id, d.tracknaam, d.artiest || 'Onbekend', d.youtube_zoekterm || `${a.titel} soundtrack`, d.reden || null]);
        hersteld++;
    }
    logger.info('Foute nummers herzocht', { hersteld });
    return { ok: true, hersteld };
}

const SCHEMA_QUIZ = {
    type: 'object', additionalProperties: false, required: ['hints', 'vragen'],
    properties: {
        hints: { type: 'array', items: { type: 'string' } },
        vragen: { type: 'array', items: {
            type: 'object', additionalProperties: false,
            required: ['vraag', 'opties', 'correct_index'],
            properties: {
                vraag: { type: 'string' },
                opties: { type: 'array', items: { type: 'string' } },
                correct_index: { type: 'integer', minimum: 0, maximum: 5 },
            },
        } },
    },
};
// Herken directe en indirecte antwoordlekken tussen hints en bonusvragen.
// Automatische controles zijn conservatief; een beheerder moet nog goedkeuren.
function quizTekst(s) {
    return String(s || '').normalize('NFD').replace(/\\p{M}/gu, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function inhoudWoorden(s) {
    const stop = new Set(['de','het','een','wat','welke','welk','waar','wie','hoe','in','op','van','bij','met','is','zijn','en','of','uit','voor','naar','als','dan','wordt','was','werd','dat','dit','ze','zij','hij','haar','hun','zijn','serie','film','amerikaanse','nederlandse','sitcom']);
    return new Set(quizTekst(s).split(' ').filter(w => w.length > 3 && !stop.has(w)));
}
function vraagHintOverlap(hint, vraag) {
    const a = inhoudWoorden(hint);
    const b = inhoudWoorden(vraag);
    const gemeen = [...b].filter(w => a.has(w));
    return gemeen.length >= 2 || (gemeen.length >= 1 && b.size <= 2);
}
function valideerQuizSet(hints, vragen) {
    if (hints.length !== 3 || vragen.length !== 3) return 'Minimaal drie hints en drie bonusvragen zijn vereist.';
    const uniek = (arr) => new Set(arr.map(quizTekst)).size === arr.length;
    if (!uniek(hints) || !uniek(vragen.map(q => q.vraag))) return 'Dubbele hints of bonusvragen.';
    for (const q of vragen) {
        if (!q.vraag || !Array.isArray(q.opties) || q.opties.length !== 6 ||
            new Set(q.opties.map(quizTekst)).size !== 6 ||
            !Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 5) {
            return 'Bonusvraag met ongeldige antwoordkeuzes.';
        }
        const juist = quizTekst(q.opties[q.correct_index]);
        if (!juist || hints.some(h => quizTekst(h).includes(juist) || vraagHintOverlap(h, q.vraag))) {
            return 'Een hint verklapt een bonusantwoord of overlapt met de vraag.';
        }
    }
    return null;
}
async function vulQuizMetadata(titelId) {
    const { rows } = await pool.query("SELECT id, naam, type, jaar, omschrijving FROM titels WHERE id = $1", [titelId]);
    const titel = rows[0];
    if (!titel || !['film', 'serie'].includes(titel.type)) return { ok: false, error: 'Geen film of serie.' };
    const prompt = `Maak voor de ${titel.type} "${titel.naam}" (${titel.jaar || 'onbekend jaar'}) EXACT drie inhoudelijk verschillende hints en EXACT drie feitelijk verifieerbare bonusvragen met ZES verschillende antwoordopties en correct_index (0-5). Gebruik verschillende feitelijke onderwerpen voor alle zes items. CRUCIAAL: geen enkele hint mag DIRECT OF INDIRECT het correcte antwoord op welke bonusvraag dan ook verklappen. Voorbeeld VERBODEN: hint "Het bedrijf verkoopt papier" en vraag "Wat verkoopt het bedrijf?". Ook synoniemen en omschrijvingen zijn verboden als lek. Hints mogen de filmtitel niet letterlijk vermelden. Weet je iets niet zeker, verzin niets: lever dan minder items en de titel blijft op controle nodig staan. Geen herhaalde jaarvragen. Korte beschrijving: ${titel.omschrijving || 'onbekend'}.`;
    const res = await codex.vraagJson({ prompt, schema: SCHEMA_QUIZ });
    if (!res.ok) return { ok: false, error: res.error };
    const hints = (res.data.hints || []).filter(x => typeof x === 'string' && x.trim()).slice(0, 3);
    const vragen = (res.data.vragen || []).slice(0, 3);
    const fout = valideerQuizSet(hints, vragen);
    if (fout) return { ok: false, error: fout, controle_nodig: true };
    // Atomair bewaren: geen halve sets als één van de inserts faalt.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            "UPDATE titels SET ai_hints = $2, ai_hints_status = 'controle_nodig' WHERE id = $1 AND ai_hints_status <> 'goedgekeurd'",
            [titelId, hints]);
        // Vervang alleen voorstellen die nog niet goedgekeurd waren.
        await client.query("DELETE FROM vragen WHERE titel_id = $1 AND soort='ai' AND ai_review_status <> 'goedgekeurd'", [titelId]);
        for (const q of vragen) {
            await client.query(
                `INSERT INTO vragen (titel_id, soort, vraag, opties, correct_index, ai_review_status)
                 VALUES ($1,'ai',$2,$3::jsonb,$4,'controle_nodig')
                 ON CONFLICT (titel_id, soort, vraag) DO NOTHING`,
                [titelId, q.vraag, JSON.stringify(q.opties), q.correct_index]);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return { ok: true, hints: 3, vragen: 3, controle_nodig: true,
        waarschuwing: 'AI-set opgeslagen maar nog niet goedgekeurd; controleer feiten en inhoudelijke overlap.' };
}

module.exports = { genereer, herzoekFout, vulQuizMetadata, valideerQuizSet, vraagHintOverlap, quizTekst, SCHEMA_FILM_SERIE, SCHEMA_KERST, CATEGORIEEN };
