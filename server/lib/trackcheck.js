// =====================================================================
// Controle: hoort deze muziek écht bij deze titel?
//
// Dit is bewust een conservatieve controle. Een ontbrekend nummer is
// vervelend; muziek van een andere film/serie onder de verkeerde titel
// maakt een quizronde onbruikbaar. Daarom wordt een onzekere match niet
// goedgekeurd en nooit automatisch gespeeld.
// =====================================================================

/** Lowercase, diakrieten weg, alleen letters/cijfers/spaties. */
function normaliseer(tekst) {
    return String(tekst || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' en ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Woorden die niets zeggen over wélke titel het is.
const RUIS = new Set([
    'de', 'het', 'een', 'the', 'a', 'an', 'van', 'of', 'and', 'en',
    'intro', 'outro', 'opening', 'openingstune', 'titelsong', 'titelmuziek',
    'tune', 'theme', 'song', 'main', 'title', 'titles', 'sequence',
    'soundtrack', 'ost', 'score', 'original', 'motion', 'picture', 'official',
    'video', 'audio', 'hd', 'hq', 'full', 'lyrics', 'remastered', 'suite',
    'generiek', 'leader', 'begintune', 'serie', 'series', 'season', 'seizoen',
    'aflevering', 'episode', 'from', 'music', 'muziek', 'thema', 'nederlandse',
    'nederlands', 'dutch', 'trailer', 'cover', 'live', 'version', 'mix',
    'feat', 'ft', 'part', 'deel', 'vol', 'edit', 'extended', 'ost',
]);

// Deze woorden werden vroeger als onschuldige zoekruis verwijderd. Dat is
// voor automatische selectie gevaarlijk: "Baantjer live" en "Baantjer 2"
// zijn geen alternatieve schrijfwijzen van de intro, maar een uitvoering of
// een ander deel. We keuren zulke markeringen daarom expliciet af. Een woord
// mag alleen blijven staan als het daadwerkelijk onderdeel is van de
// officiële titel/alias.
const ONGELDIGE_VARIANT_MARKERINGEN = new Set([
    'live', 'livestream', 'concert', 'karaoke', 'cover', 'remix', 'version',
    'edit', 'extended', 'part', 'deel', 'vol', 'volume', 'episode',
    'aflevering', 'season', 'seizoen', 'trailer', 'reaction', 'review',
    'explained', 'interview', 'performance', 'optreden', 'medley',
    'compilation', 'compilatie', 'full', 'complete',
]);

function tokens(tekst) {
    return normaliseer(tekst).split(' ').filter(Boolean);
}

/** Controleer hele woordreeksen, niet alleen losse substrings. */
function bevatWoordreeks(tekst, reeks) {
    const bron = tokens(tekst);
    const doel = tokens(reeks);
    if (!doel.length || doel.length > bron.length) return false;
    for (let i = 0; i <= bron.length - doel.length; i++) {
        if (doel.every((woord, j) => bron[i + j] === woord)) return true;
    }
    return false;
}

/** Betekenisvolle woorden uit een naam (ruis en jaartallen weg). */
function kernWoorden(tekst) {
    return tokens(tekst).filter(
        (w) => w.length > 1 && !RUIS.has(w) && !/^\d{4}$/.test(w),
    );
}

function titelNamen(titel) {
    return [...new Set([titel?.naam, ...(titel?.aliassen || [])].filter(Boolean))];
}

function explicieteJaren(tekst) {
    return [...String(tekst || '').matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
}

function telTokens(woorden) {
    const telling = new Map();
    for (const woord of woorden) telling.set(woord, (telling.get(woord) || 0) + 1);
    return telling;
}

/**
 * Geef een reden terug als de kandidaat duidelijk een verkeerde uitvoering,
 * aflevering/deel of genummerde variant is. Viercijferige jaartallen zijn
 * toegestaan; overige cijfers moeten in de titel/alias zelf voorkomen.
 */
function variantMarkering(titel, tekst) {
    const kandidaat = tokens(tekst);
    const officiëleTokens = tokens(titelNamen(titel).join(' '));
    const officiëleTelling = telTokens(officiëleTokens);
    const kandidaatTelling = telTokens(kandidaat);

    for (const [woord, aantal] of kandidaatTelling) {
        const extra = aantal - (officiëleTelling.get(woord) || 0);
        if (extra <= 0) continue;
        if (ONGELDIGE_VARIANT_MARKERINGEN.has(woord)) {
            return `ongewenste variantmarkering (${woord})`;
        }
        if (/^\d+$/.test(woord) && !/^\d{4}$/.test(woord)) {
            return `genummerde variant (deel ${woord})`;
        }
    }
    return null;
}

/**
 * Beoordeel een gevonden nummer.
 *
 * @returns {{past:boolean, zekerheid:number, reden:string, matchNaam?:string}}
 */
function beoordeelTrack(titel, track) {
    const namen = titelNamen(titel);
    // De artiest/YouTube-kanaal is bewust géén titelbewijs: een kanaal kan
    // willekeurig zo heten en mag nooit samen met de tracknaam een valse
    // woordreeks vormen.
    const tekst = [track?.tracknaam, track?.album]
        .filter(Boolean)
        .join(' ');
    const hooi = normaliseer(tekst);
    if (!hooi) {
        return { past: false, zekerheid: 0, reden: 'geen tracknaam' };
    }

    const variant = variantMarkering(titel, tekst);
    if (variant) {
        return { past: false, zekerheid: 0, reden: variant };
    }

    // Een expliciet ander jaartal is een harde weigering. Dit voorkomt dat
    // delen uit een filmreeks door elkaar raken (bijv. Pirates 2003/2006).
    // Een jaartal in de artiestnaam (bijv. de band "The 1975") is geen
    // releasejaar en mag daarom niet als conflict tellen.
    const jaren = explicieteJaren(
        [track?.tracknaam, track?.album].filter(Boolean).join(' '),
    );
    if (titel?.jaar && jaren.length && !jaren.includes(Number(titel.jaar))) {
        return {
            past: false,
            zekerheid: 0,
            reden: `jaartal wijkt af (${jaren.join(', ')})`,
        };
    }

    let beste = null;
    for (const naam of namen) {
        const genorm = normaliseer(naam);
        if (genorm.length < 3) continue;

        // Volledige titel of alias als aaneengesloten woordreeks is het
        // sterkste signaal. Dit voorkomt substring-fouten zoals "it" in
        // willekeurige woorden.
        if (bevatWoordreeks(hooi, genorm)) {
            beste = {
                zekerheid: 1,
                reden: 'volledige titel of alias gevonden',
                matchNaam: naam,
            };
            break;
        }

        const kern = kernWoorden(naam);
        const hooiWoorden = new Set(tokens(hooi));
        const raak = kern.filter((w) => hooiWoorden.has(w));

        // Eén betekenisvol woord moet lang genoeg zijn. Korte filmtitels
        // zijn te ambigu om automatisch goed te keuren.
        if (kern.length === 1 && kern[0].length >= 4 && raak.length === 1) {
            beste = beste && beste.zekerheid >= 0.9
                ? beste
                : { zekerheid: 0.88, reden: 'uniek kernwoord gevonden', matchNaam: naam };
        }

        // Bij meerwoordige titels moeten alle kernwoorden aanwezig zijn.
        if (kern.length >= 2 && raak.length === kern.length) {
            beste = beste && beste.zekerheid >= 0.92
                ? beste
                : { zekerheid: 0.94, reden: 'alle kernwoorden gevonden', matchNaam: naam };
        }
    }

    if (!beste || beste.zekerheid < 0.85) {
        return {
            past: false,
            zekerheid: beste?.zekerheid || 0,
            reden: 'titelnaam of alias niet overtuigend gevonden',
        };
    }
    return { past: true, ...beste };
}

// Backwards-compatible naam voor alle bestaande import- en enginecode.
function pastBijTitel(titel, track) {
    return beoordeelTrack(titel, track);
}

module.exports = {
    pastBijTitel,
    beoordeelTrack,
    normaliseer,
    tokens,
    bevatWoordreeks,
    kernWoorden,
    titelNamen,
    variantMarkering,
};
