// =====================================================================
// Beheer 2.0 — alle AI-vragen van de curator (ChatGPT via Codex).
//
// Elke functie bouwt één prompt + JSON-schema, vraagt het antwoord op en
// geeft opgeschoonde, gevalideerde data terug. Opslaan gebeurt in de
// worker; dit bestand raakt de database niet aan.
// =====================================================================

const codex = require('./codex');
const { CATEGORIEEN, TIERS, norm } = require('./bank');

const NU = new Date().getFullYear();

const CRITERIA = `
DOELGROEP: VenTune is vooral een nostalgisch spel voor volwassenen (ongeveer 25-60 jaar) die terugdenken aan vroeger. Beoordeel bekendheid vanuit hen, niet vanuit kinderen van nu.
- alleen_kids_nu=true voor kinderprogramma's/-series, kinderfilms of kidsmuziek die vooral bekend zijn bij kinderen van nu (ongeveer 6-14 jaar) en die volwassenen niet van vroeger kennen (bv. recente Nickelodeon-, Disney Channel-, Netflix Kids- of YouTube-kidstitels). Kinderseries die volwassenen van hun eigen jeugd kennen (Alfred J. Kwak, Maya de Bij, Teletubbies, Pokémon, Bassie & Adriaan, Sesamstraat) zijn juist wél goed: alleen_kids_nu=false.

BEKENDHEID (kies precies één, kijk naar Nederland). Kijk naar de titel ÉN het nummer:
- iconisch: zowel de titel als het nummer zijn vrijwel bij iedereen in Nederland bekend; je herkent het meteen, ook als je geen fan bent (Rocky + Eye of the Tiger, Star Wars, Friends, Titanic, Super Mario, Last Christmas).
- algemeen_bekend: óf de titel óf het nummer is breed bekend, de ander iets minder; de meeste Nederlanders kennen het (bv. Sliders, Baywatch, Knight Rider).
- bekend: bekend bij een flink deel van het publiek en bij iedereen die het genre volgt.
- onbekend: vooral fans en kenners herkennen het.
- cult: echt niche, met een kleine maar trouwe fanbase die het als klassieker ziet. Een serie die in Nederland jarenlang op tv was (zoals Sliders) is géén cult maar minstens algemeen bekend.
Bij videogames tellen het spel én de muziek, gemeten onder mensen die games spelen of speelden: is het spel óf de gamemuziek iconisch, dan is het iconisch. Een miljoenenverkoper die bij een populaire console hoorde en waarvan iedereen met die console het thema kent, is iconisch: Super Mario, Tetris, Pac-Man, Wii Sports, Mario Kart, Zelda (ook A Link to the Past en Ocarina of Time), Pokémon Rood/Blauw, Sonic, Street Fighter II, The Sims, GTA San Andreas, Minecraft, Halo, Final Fantasy VII. Wees bij games niet te streng: de vraag is of gamers het thema herkennen, niet of je oma het kent.
Bij anime vergelijk je binnen anime: Pokémon, Dragon Ball en Naruto zijn iconisch; Death Note, One Piece, Attack on Titan, Ghost in the Shell en Sailor Moon zijn algemeen bekend of bekend.

BEKEND IN NEDERLAND (nl_bekend):
- ja: breed bekend in Nederland: uitgezonden op Nederlandse tv (NPO, RTL, SBS6, Net5, Veronica, Nickelodeon, Fox Kids, Jetix, Disney Channel …), grote bioscooprelease in NL, populair op streaming in NL, een game die hier veel gespeeld is, of een nummer dat in Nederland een hit was (Top 40, Top 2000, radio).
- Anime: "ja" als de anime in Nederland te zien was (tv, Netflix, Crunchyroll, bioscoop) en Nederlandse animefans hem kennen; anime hoeft niet bij het grote publiek bekend te zijn.
- nee: weinig Nederlanders kennen het. Denk aan de meeste Franse, Duitse, Spaanse, Italiaanse, Scandinavische, Latijns-Amerikaanse, Turkse, Indiase en Aziatische series en films die hier nooit breed te zien waren, lokale tv uit andere landen, talkshows, nieuws, obscure titels.
- twijfel: alleen als het echt onduidelijk is.

CATEGORIE:
- film / serie: speelfilms en tv-series (ook westerse animatie zoals Disney, Pixar, The Simpsons).
- Oude Japanse of Japans-Europese tekenfilmseries die in Nederland als gewone kinder-tekenfilm op tv waren (vooral jaren 70-80, nagesynchroniseerd: Maya de Bij, Mrs. Theelepel, Nils Holgersson, Heidi, Alfred J. Kwak, Barbapapa, Vicky de Viking, Wickie) zijn géén anime maar categorie serie.
- anime: Japanse animeseries en -films die Nederlanders als ANIME kennen (Naruto, Death Note, Ghost in the Shell, Dragon Ball, One Piece, Attack on Titan, Pokémon, Sailor Moon, Studio Ghibli). Westerse animatie (Disney, Pixar, DreamWorks, The Simpsons) is géén anime maar film of serie. Zet anime_breed_bekend=true als ook mensen die niets met anime hebben het in Nederland kennen (bv. Pokémon, Dragon Ball Z, Sailor Moon, Spirited Away); anders false.
- game: videogames; het nummer is gamemuziek.
- muziek: een los nummer (single/hit) dat niet bij een film, serie of game hoort.
- kerst: kerstmuziek. kinder: kinderliedjes.

TAAL VAN HET NUMMER: nl_versie=true als Nederlanders de titelsong vooral in een NEDERLANDSTALIGE versie kennen (nagesynchroniseerde series en films zoals Maya de Bij, Pokémon, Nils Holgersson, Alfred J. Kwak, Disney-liedjes in het Nederlands). Dan zijn nummer_naam en yt_zoekterm die van de Nederlandse versie (bv. "Maya de Bij intro Nederlands"). Anders false: dan geldt het origineel. Nooit een Duitse, Franse, Spaanse of andere anderstalige versie.

HET NUMMER: het herkenningsnummer dat spelers moeten herkennen. Film/serie/anime: de titelsong, intro of het bekendste thema. Game: het bekendste originele gamethema. Muziek/kerst/kinder: het nummer zelf (nummer_naam = naam, nummer_artiest = de originele uitvoerende artiest). yt_zoekterm vindt de ORIGINELE versie op YouTube (of de Nederlandse versie bij nl_versie=true; geen cover, live of remix).

GEGEVENS KLOPPEN: jaar = jaar van de (eerste) release, bij een serie het beginjaar. eind_jaar = laatste jaar van een serie die is afgelopen (null bij films, games, muziek of een serie die nog loopt); serie_lopend = true als een serie nog loopt. taal = "nl" alleen voor Nederlandstalige producties/nummers (Flodder, Baantjer, Marco Borsato), anders "en" — The Office, Friends en Pokémon zijn dus "en". land = productieland als code (NL, BE, US, GB, JP, FR, DE, …).

ANTWOORD: spelers raden de naam (film, serie, game of nummertitel). franchise is de korte naam van de reeks die spelers ook goed mogen rekenen, versie-onafhankelijk (bv. "Terminator" voor Terminator 2, "Super Mario" voor Super Mario Bros. 3, "Harry Potter"). Leeg als er geen reeks is. aliassen: andere geldige namen (Nederlandse titel, originele titel, gangbare afkorting zoals "GTA"), maximaal 5, zonder de franchise te herhalen.

geschikt=false als er geen herkenbaar nummer bestaat of de titel ongeschikt is voor een muziekquiz (nieuws, talkshow, documentaire zonder herkenbaar thema, dubbel record).`;

const GUARD = `Werk feitelijk. Controleer twijfelgevallen met web search. Verzin niets. Antwoord in het Nederlands waar tekst gevraagd wordt.`;

const S = (type, extra = {}) => ({ type, ...extra });
const STR = S('string');
const STR_ARR = S('array', { items: STR });

const BEOORDELING_PROPS = {
    naam: STR,
    categorie: S('string', { enum: CATEGORIEEN }),
    anime_breed_bekend: S('boolean'),
    bekendheid: S('string', { enum: TIERS }),
    nl_bekend: S('string', { enum: ['ja', 'nee', 'twijfel'] }),
    nl_reden: STR,
    jaar: S(['integer', 'null']),
    eind_jaar: S(['integer', 'null']),
    serie_lopend: S('boolean'),
    taal: S('string', { enum: ['nl', 'en'] }),
    land: STR,
    franchise: STR,
    aliassen: STR_ARR,
    nummer_naam: STR,
    nummer_artiest: STR,
    yt_zoekterm: STR,
    nl_versie: S('boolean'),
    alleen_kids_nu: S('boolean'),
    geschikt: S('boolean'),
    notitie: STR,
};

function objectSchema(props) {
    return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}

function lijstSchema(itemProps) {
    return objectSchema({ items: S('array', { items: objectSchema(itemProps) }) });
}

function schoonTekst(v, max = 200) {
    return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Maak een AI-beoordeling veilig om op te slaan. */
function schoonBeoordeling(b) {
    if (!b || typeof b !== 'object') return null;
    const jaar = Number.isInteger(b.jaar) && b.jaar >= 1900 && b.jaar <= NU + 1 ? b.jaar : null;
    const franchise = schoonTekst(b.franchise, 120);
    const naam = schoonTekst(b.naam, 200);
    return {
        naam,
        categorie: CATEGORIEEN.includes(b.categorie) ? b.categorie : null,
        anime_breed_bekend: b.anime_breed_bekend === true,
        bekendheid: TIERS.includes(b.bekendheid) ? b.bekendheid : null,
        nl_bekend: ['ja', 'nee', 'twijfel'].includes(b.nl_bekend) ? b.nl_bekend : 'twijfel',
        nl_reden: schoonTekst(b.nl_reden, 300),
        jaar,
        eind_jaar: Number.isInteger(b.eind_jaar) && jaar && b.eind_jaar >= jaar && b.eind_jaar <= NU + 1 ? b.eind_jaar : null,
        serie_lopend: b.serie_lopend === true,
        taal: b.taal === 'nl' ? 'nl' : 'en',
        land: /^[A-Z]{2,3}$/.test(String(b.land || '').trim().toUpperCase()) ? String(b.land).trim().toUpperCase() : null,
        franchise: norm(franchise) && norm(franchise) !== norm(naam) ? franchise : '',
        aliassen: [...new Set((Array.isArray(b.aliassen) ? b.aliassen : [])
            .map((a) => schoonTekst(a, 120)).filter((a) => a && norm(a) !== norm(naam)))].slice(0, 5),
        nummer_naam: schoonTekst(b.nummer_naam, 200),
        nummer_artiest: schoonTekst(b.nummer_artiest, 200),
        yt_zoekterm: schoonTekst(b.yt_zoekterm, 200),
        nl_versie: b.nl_versie === true,
        alleen_kids_nu: b.alleen_kids_nu === true,
        geschikt: b.geschikt !== false,
        notitie: schoonTekst(b.notitie, 400),
    };
}

/**
 * Beoordeel een batch bestaande titels.
 * @param {Array<object>} titels  rijen uit titels (id, naam, type, jaar, land, categorie, nummer_naam …)
 * @returns {Promise<{ok:true, items: Map<number, object>}|{ok:false, error:string}>}
 */
async function beoordeel(titels, signal) {
    const invoer = titels.map((t) => ({
        id: t.id,
        naam: t.naam,
        type: t.type,
        jaar: t.jaar || null,
        land: t.land || null,
        huidige_categorie: t.categorie || null,
        huidige_taal: t.taal || null,
        bekend_nummer: [t.nummer_naam || t.tracknaam, t.nummer_artiest || t.artiest].filter(Boolean).join(' – ') || null,
    }));
    const prompt = `Je bent de curator van VenTune, een Nederlandse muziekquiz (zoals Hitster) waarin spelers een film, serie, anime, game of nummer herkennen aan de muziek.

Hieronder staat een lijst. Beoordeel elk item in de lijst ten opzichte van de andere (hoe bekend is dit vergeleken met de rest?), controleer of de gegevens kloppen en vul alle velden in. Houd het id gelijk. Corrigeer de naam alleen naar de gangbare officiële schrijfwijze (zoals Nederlanders hem kennen); verander niet naar een andere titel.
${CRITERIA}

${GUARD}

Items:
${invoer.map((i) => JSON.stringify(i)).join('\n')}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({ id: S('integer'), ...BEOORDELING_PROPS }),
        signal,
    });
    if (!res.ok) return res;
    const items = new Map();
    const geldig = new Set(titels.map((t) => t.id));
    for (const raw of res.data?.items || []) {
        if (!geldig.has(raw?.id)) continue;
        const b = schoonBeoordeling(raw);
        if (b) items.set(raw.id, b);
    }
    return { ok: true, items };
}

/**
 * Laat de AI nieuwe titels aandragen voor een categorie.
 * @returns {Promise<{ok:true, items:Array<object>}|{ok:false,error:string}>}
 */
async function vulAan({ categorie, aantal, periode, tier, bestaand }, signal) {
    const wat = {
        film: 'films', serie: 'tv-series', anime: 'anime (Japanse animatieseries en -films)',
        game: 'videogames (met herkenbare originele gamemuziek)', muziek: 'losse muziekhits (geen film-, serie- of gamemuziek, geen kerst- of kinderliedjes)',
        kerst: 'kerstnummers', kinder: 'kinderliedjes die Nederlandse kinderen kennen',
    }[categorie];
    const periodeRegel = periode ? `Uit de periode ${periode}.` : '';
    // Stap 1 van 3: alleen een lijst met namen. Bekendheid, NL-check,
    // gegevens en het nummer volgen daarna in één beoordelingsronde per
    // lijst; hints en vragen weer in een volgende lijst.
    const prompt = `Je vult de vragenbank van VenTune, een Nederlandse muziekquiz waarin spelers iets herkennen aan de muziek.

Geef een LIJST van ${aantal} nieuwe ${wat} die in Nederland bekend zijn en een herkenbaar origineel nummer hebben. ${periodeRegel}
Denk aan wat volwassenen (25-60) van vroeger kennen; geen titels die alleen kinderen van nu kennen.
Ze moeten bekendheid "${tier}" hebben${tier === 'iconisch' ? ' (alleen het allerbekendste: wat vrijwel iedereen in Nederland meteen herkent)' : ''}.
Niets uit de lijst hieronder (ook geen andere schrijfwijze of een los deel van dezelfde reeks met hetzelfde nummer). Liever minder dan obscure of verzonnen titels.
Per item alleen: naam (zoals Nederlanders hem kennen), jaar (release; bij series het beginjaar), artiest (alleen bij muziek/kerst/kinder, anders leeg) en bekendheid (je eerlijke inschatting: iconisch, algemeen_bekend, bekend, onbekend of cult).

${GUARD}

Bestaat al (overslaan):
${bestaand.length ? bestaand.join(' | ') : '(nog niets)'}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({
            naam: STR,
            jaar: S(['integer', 'null']),
            artiest: STR,
            bekendheid: S('string', { enum: TIERS }),
        }),
        signal,
    });
    if (!res.ok) return res;
    const items = [];
    for (const raw of res.data?.items || []) {
        const naam = schoonTekst(raw?.naam, 200);
        if (!naam) continue;
        items.push({
            naam,
            jaar: Number.isInteger(raw.jaar) && raw.jaar >= 1900 && raw.jaar <= NU + 1 ? raw.jaar : null,
            artiest: schoonTekst(raw.artiest, 200),
            bekendheid: TIERS.includes(raw.bekendheid) ? raw.bekendheid : null,
        });
    }
    return { ok: true, items };
}

// ------------------------------------------------------------------
// Hints en bonusvragen
// ------------------------------------------------------------------

function bevatAntwoord(tekst, namen) {
    const t = ` ${norm(tekst)} `;
    return namen.some((n) => n && n.length >= 3 && t.includes(` ${n} `));
}

/** Controleer een quizset; geeft {hints, vragen} of null terug. */
function schoonQuiz(raw, titel) {
    const namen = [titel.naam, titel.franchise, ...(titel.aliassen || [])].map(norm).filter(Boolean);
    const hints = (Array.isArray(raw?.hints) ? raw.hints : [])
        .map((h) => schoonTekst(h, 220)).filter((h) => h && !bevatAntwoord(h, namen));
    const vragen = [];
    for (const v of Array.isArray(raw?.vragen) ? raw.vragen : []) {
        const vraag = schoonTekst(v?.vraag, 240);
        const juist = schoonTekst(v?.juist, 120);
        const fout = [...new Set((Array.isArray(v?.fout) ? v.fout : []).map((f) => schoonTekst(f, 120)).filter(Boolean))]
            .filter((f) => norm(f) !== norm(juist)).slice(0, 5);
        if (!vraag || !juist || fout.length < 5) continue;
        // Een hint mag het antwoord op een bonusvraag niet verklappen.
        if (hints.some((h) => norm(juist).length >= 4 && ` ${norm(h)} `.includes(` ${norm(juist)} `))) continue;
        vragen.push({ vraag, juist, fout });
    }
    if (!hints.length && !vragen.length) return null;
    return { hints: hints.slice(0, 3), vragen: vragen.slice(0, 3) };
}

// Bonusvragen komen ná de onthulling, dus daar mag de naam wel in staan.
// Alleen de hints zijn streng.

function maakOpties(vraag) {
    const opties = [vraag.juist, ...vraag.fout];
    for (let i = opties.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opties[i], opties[j]] = [opties[j], opties[i]];
    }
    return { opties, correct_index: opties.indexOf(vraag.juist) };
}

async function maakQuiz(titels, signal) {
    const invoer = titels.map((t) => ({
        id: t.id, naam: t.naam, categorie: t.categorie, jaar: t.jaar || null,
        nummer: [t.nummer_naam, t.nummer_artiest].filter(Boolean).join(' – ') || null,
        omschrijving: t.omschrijving || null,
    }));
    const prompt = `Maak voor elke titel in deze lijst voor VenTune (Nederlandse muziekquiz) precies 3 hints en 3 bonusvragen, in het Nederlands. De 6 items per titel gaan elk over een ANDER onderwerp en hebben geen raakvlakken met elkaar (geen hint die een vraag beantwoordt of naar hetzelfde feit verwijst).

HINTS (tijdens het raden, van vaag naar concreet): helpen de titel te raden zonder de naam, franchise of een deel daarvan te noemen. Film/serie/anime: hoofdpersonage, acteur, setting, plot zonder spoilers. Game: platform, maker, hoofdpersonage, genre. Muziek/kerst/kinder: artiest, jaar/decennium, waar je het hoort — zonder de nummertitel.
BONUSVRAGEN (na het raden, meerkeuze): feitelijk en controleerbaar, elk een ander onderwerp, hooguit één jaartalvraag. "juist" is het goede antwoord, "fout" precies 5 geloofwaardige foute antwoorden van hetzelfde soort. Een hint mag het antwoord op een bonusvraag niet verklappen.

${GUARD}

Titels:
${invoer.map((i) => JSON.stringify(i)).join('\n')}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({
            id: S('integer'),
            hints: STR_ARR,
            vragen: S('array', { items: objectSchema({ vraag: STR, juist: STR, fout: STR_ARR }) }),
        }),
        signal,
    });
    if (!res.ok) return res;
    const items = new Map();
    const perId = new Map(titels.map((t) => [t.id, t]));
    for (const raw of res.data?.items || []) {
        const titel = perId.get(raw?.id);
        if (!titel) continue;
        const q = schoonQuiz(raw, titel);
        if (q) items.set(titel.id, q);
    }
    return { ok: true, items };
}

// ------------------------------------------------------------------
// MP3: de juiste YouTube-video kiezen en bestaande tracks controleren
// ------------------------------------------------------------------

function duur(s) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

async function kiesVideo(lijst, signal) {
    const invoer = lijst.map(({ titel, kandidaten }) => ({
        id: titel.id,
        zoek: { naam: titel.naam, categorie: titel.categorie, jaar: titel.jaar || null,
            nummer: titel.nummer_naam || null, artiest: titel.nummer_artiest || null,
            versie: titel.nl_versie ? 'Nederlandstalig' : 'origineel' },
        kandidaten: kandidaten.map((k, i) => ({ i, titel: k.titel, kanaal: k.kanaal || null, duur: duur(k.duurSeconden), views: k.views || null })),
    }));
    const prompt = `Kies voor elke zoekopdracht de YouTube-video met de ORIGINELE versie van het gevraagde nummer, voor een muziekquiz.
Wel: officiële video of audio, "- Topic"-kanalen, het originele titelthema/intro/gamethema, duur tussen ongeveer 0:20 en 7:00.
Taal: bij versie "Nederlandstalig" alleen de Nederlandse versie (Nederlandse titelsong/nasynchronisatie); bij "origineel" de originele taal. NOOIT een Duitse, Franse, Spaanse, Italiaanse, Poolse of andere anderstalige versie (let op titels als "deutsch", "German", "français", "español", "Titellied").
Niet: covers, live, remix, sped up/slowed, nightcore, piano/8-bit/orkest-versies (tenzij dat het origineel is), trailers, reacties, uitleg, compilaties, "1 hour"/"10 hours", karaoke, een ander deel of seizoen met ander thema.
Geef keuze = index van de kandidaat, of -1 als geen enkele kandidaat zeker goed is. reden: korte uitleg in het Nederlands.

${invoer.map((i) => JSON.stringify(i)).join('\n')}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({ id: S('integer'), keuze: S('integer'), reden: STR }),
        signal,
    });
    if (!res.ok) return res;
    const uit = new Map();
    for (const r of res.data?.items || []) {
        const item = lijst.find((l) => l.titel.id === r?.id);
        if (!item) continue;
        const k = Number.isInteger(r.keuze) && r.keuze >= 0 ? item.kandidaten[r.keuze] : null;
        uit.set(r.id, { kandidaat: k || null, reden: schoonTekst(r.reden, 300) });
    }
    return { ok: true, items: uit };
}

async function controleerTracks(lijst, signal) {
    const invoer = lijst.map((r) => ({
        id: r.track_id,
        verwacht: { naam: r.naam, categorie: r.categorie, nummer: r.nummer_naam || null, artiest: r.nummer_artiest || null },
        mp3: { youtube_titel: r.youtube_titel || null, tracknaam: r.tracknaam || null, artiest: r.artiest || null, bron: r.bron_url || null },
    }));
    const prompt = `Controleer per regel of de opgeslagen MP3 (gegevens van de bron) het verwachte nummer is voor een muziekquiz: de originele versie, geen cover/live/remix/trailer/ander nummer.
oordeel: "goed", "fout" of "onzeker". reden kort in het Nederlands.

${invoer.map((i) => JSON.stringify(i)).join('\n')}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({ id: S('integer'), oordeel: S('string', { enum: ['goed', 'fout', 'onzeker'] }), reden: STR }),
        signal,
    });
    if (!res.ok) return res;
    const uit = new Map();
    for (const r of res.data?.items || []) {
        if (Number.isInteger(r?.id)) uit.set(r.id, { oordeel: r.oordeel, reden: schoonTekst(r.reden, 300) });
    }
    return { ok: true, items: uit };
}

// ------------------------------------------------------------------
// Verbeterpunten: steekproef nalopen
// ------------------------------------------------------------------

const AUDIT_VELDEN = ['naam', 'categorie', 'bekendheid', 'nl_bekend', 'jaar', 'franchise', 'nummer_naam', 'nummer_artiest'];

async function audit(titels, signal) {
    const invoer = titels.map((t) => ({
        id: t.id, naam: t.naam, categorie: t.categorie, bekendheid: t.bekendheid_tier,
        nl_bekend: t.nl_bekend, jaar: t.jaar, franchise: t.franchise || '',
        nummer_naam: t.nummer_naam || '', nummer_artiest: t.nummer_artiest || '',
    }));
    const prompt = `Je controleert de vragenbank van VenTune (Nederlandse muziekquiz). Loop deze items kritisch na en geef ALLEEN echte fouten terug als correctie (veld + nieuwe waarde + korte reden). Geen correcties = lege lijst.
Let op: verkeerd jaartal, verkeerde categorie (anime hoort niet bij film/serie), te hoge of te lage bekendheid, titels die in Nederland niet bekend zijn (nl_bekend nee), verkeerd herkenningsnummer of artiest, ontbrekende franchise.
nieuwe_waarde is altijd tekst (jaartal als cijfers).
${CRITERIA}

${GUARD}

${invoer.map((i) => JSON.stringify(i)).join('\n')}`;
    const res = await codex.vraagJson({
        prompt,
        schema: objectSchema({
            correcties: S('array', { items: objectSchema({
                id: S('integer'), veld: S('string', { enum: AUDIT_VELDEN }), nieuwe_waarde: STR, reden: STR,
            }) }),
        }),
        signal,
    });
    if (!res.ok) return res;
    const ids = new Set(titels.map((t) => t.id));
    const correcties = (res.data?.correcties || [])
        .filter((c) => ids.has(c?.id) && AUDIT_VELDEN.includes(c.veld))
        .map((c) => ({ id: c.id, veld: c.veld, waarde: schoonTekst(c.nieuwe_waarde, 200), reden: schoonTekst(c.reden, 300) }));
    return { ok: true, correcties };
}

// ------------------------------------------------------------------
// Collecties (Sinterklaas, Rock, Disney …)
// ------------------------------------------------------------------

const SOORT_UITLEG = {
    muziek: 'Kijk naar het NUMMER: ook een film, serie of game hoort erbij als het herkenningsnummer past (bv. Rocky met Eye of the Tiger in Rock).',
    film: 'Alleen films.',
    serie: 'Alleen series.',
    beide: 'Films, series en anime.',
    alles: 'Alles: films, series, anime, games en muziek.',
};

function collectieRegel(c) {
    return `- ${c.sleutel}: "${c.naam}" — ${c.ai_criteria || c.beschrijving || c.naam}. ${SOORT_UITLEG[c.standaard_type] || ''}`;
}

/**
 * Welke titels uit de lijst horen in welke collecties? Eén lijst titels,
 * meerdere collecties tegelijk: zo kost een scan van de database weinig.
 * @returns {Promise<{ok:true, items: Map<number, string[]>}|{ok:false,error:string}>}
 */
async function deelCollectiesIn(titels, collecties, signal) {
    const prompt = `Je beheert de collecties (thema's) van VenTune, een Nederlandse muziekquiz waarin spelers iets herkennen aan de muziek.
Bepaal per titel in welke van deze collecties hij past. Een titel mag in meerdere collecties of in geen enkele. Wees streng: alleen als het duidelijk past.

Collecties:
${collecties.map(collectieRegel).join('\n')}

Geef ALLEEN titels terug die in minstens één collectie passen, met id en de sleutels van de collecties.
${GUARD}

Titels (id | categorie | naam | jaar | nummer):
${titels.map((t) => `${t.id} | ${t.categorie || t.type} | ${t.naam} | ${t.jaar || ''} | ${[t.nummer_naam, t.nummer_artiest].filter(Boolean).join(' – ')}`).join('\n')}`;
    const sleutels = collecties.map((c) => c.sleutel);
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({ id: S('integer'), collecties: S('array', { items: S('string', { enum: sleutels }) }) }),
        signal,
    });
    if (!res.ok) return res;
    const geldig = new Set(titels.map((t) => t.id));
    const items = new Map();
    for (const r of res.data?.items || []) {
        if (!geldig.has(r?.id)) continue;
        const lijst = [...new Set((r.collecties || []).filter((x) => sleutels.includes(x)))];
        if (lijst.length) items.set(r.id, lijst);
    }
    return { ok: true, items };
}

/** Nieuwe items voor één collectie bedenken (bestaande worden hergebruikt). */
async function vulCollectieAan(c, { aantal, bestaand }, signal) {
    const prompt = `Je vult de collectie "${c.naam}" van VenTune, een Nederlandse muziekquiz voor volwassenen die terugdenken aan vroeger.
Wat hoort erin: ${c.ai_criteria || c.beschrijving || c.naam}. ${SOORT_UITLEG[c.standaard_type] || ''}

Geef een LIJST van maximaal ${aantal} items die in Nederland bekend zijn en een herkenbaar nummer hebben. Begin met het allerbekendste.
Per item: naam (zoals Nederlanders hem kennen; bij muziek de nummertitel), categorie (film, serie, anime, game, muziek, kerst of kinder — kinder voor kinderliedjes, ook Sinterklaasliedjes), jaar, artiest (alleen bij muziek/kerst/kinder) en bekendheid.
Niets uit de lijst hieronder. Liever minder dan obscure of verzonnen items.

${GUARD}

Zit er al in (overslaan):
${bestaand.length ? bestaand.join(' | ') : '(nog niets)'}`;
    const res = await codex.vraagJson({
        prompt,
        schema: lijstSchema({
            naam: STR,
            categorie: S('string', { enum: CATEGORIEEN }),
            jaar: S(['integer', 'null']),
            artiest: STR,
            bekendheid: S('string', { enum: TIERS }),
        }),
        signal,
    });
    if (!res.ok) return res;
    const items = [];
    for (const raw of res.data?.items || []) {
        const naam = schoonTekst(raw?.naam, 200);
        if (!naam || !CATEGORIEEN.includes(raw.categorie)) continue;
        items.push({
            naam,
            categorie: raw.categorie,
            jaar: Number.isInteger(raw.jaar) && raw.jaar >= 1900 && raw.jaar <= NU + 1 ? raw.jaar : null,
            artiest: schoonTekst(raw.artiest, 200),
            bekendheid: TIERS.includes(raw.bekendheid) ? raw.bekendheid : null,
        });
    }
    return { ok: true, items };
}

module.exports = {
    deelCollectiesIn, vulCollectieAan,
    beoordeel, vulAan, maakQuiz, kiesVideo, controleerTracks, audit,
    // voor tests
    schoonBeoordeling, schoonQuiz, maakOpties,
};
