// =====================================================================
// Fuzzy matching voor titelgokken.
//
// 1. Normaliseer: lowercase, diakrieten strippen, leestekens weg,
//    lidwoorden weg (de, het, een, the, a), whitespace collapsen.
// 2. Vergelijk met de Dice-coëfficiënt op bigrams. Drempel 0,82.
// 3. Check ook alle aliassen; de hoogste score telt.
// 4. Score tussen 0,70 en 0,82 → 'bijna' (geen tijd aftrekken).
// =====================================================================

const DREMPEL_GOED = 0.82;
const DREMPEL_BIJNA = 0.7;

const LIDWOORDEN = new Set(['de', 'het', 'een', 'the', 'a', 'an']);

/** Strip diakrieten (é → e) via Unicode-normalisatie. */
function stripDiakrieten(tekst) {
    return tekst.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliseer een titel of gok tot een vergelijkbare vorm. */
function normaliseer(tekst) {
    if (!tekst) return '';
    let t = stripDiakrieten(String(tekst).toLowerCase());
    // Leestekens en cijfers-losse tekens weg, behoud letters/cijfers/spatie.
    t = t.replace(/[^a-z0-9\s]/g, ' ');
    // Lidwoorden verwijderen.
    t = t
        .split(/\s+/)
        .filter((w) => w && !LIDWOORDEN.has(w))
        .join(' ');
    // Whitespace collapsen.
    return t.replace(/\s+/g, ' ').trim();
}

/** Maak de set bigrams (paren opeenvolgende tekens, spaties genegeerd). */
function bigrammen(str) {
    const schoon = str.replace(/\s+/g, '');
    const paren = [];
    for (let i = 0; i < schoon.length - 1; i++) {
        paren.push(schoon.slice(i, i + 2));
    }
    return paren;
}

/** Levenshtein-afstand tussen twee strings. */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
        const huidig = [i + 1];
        for (let j = 0; j < b.length; j++) {
            const kost = a[i] === b[j] ? 0 : 1;
            huidig[j + 1] = Math.min(
                huidig[j] + 1,
                vorige[j + 1] + 1,
                vorige[j] + kost,
            );
        }
        vorige = huidig;
    }
    return vorige[b.length];
}

/** Levenshtein-gelijkenis genormaliseerd naar 0..1. */
function levGelijkenis(a, b) {
    const max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    return 1 - levenshtein(a, b) / max;
}

/** Dice-coëfficiënt (2·|A∩B| / (|A|+|B|)) op bigram-multisets. */
function dice(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigramsA = bigrammen(a);
    const bigramsB = bigrammen(b);

    // Multiset-telling van A.
    const telling = new Map();
    for (const g of bigramsA) {
        telling.set(g, (telling.get(g) || 0) + 1);
    }

    let overlap = 0;
    for (const g of bigramsB) {
        const n = telling.get(g) || 0;
        if (n > 0) {
            overlap++;
            telling.set(g, n - 1);
        }
    }

    return (2 * overlap) / (bigramsA.length + bigramsB.length);
}

const ROMEINS = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const MUZIEK = new Set(['muziek', 'kerst', 'kinder']);

/**
 * Versie-onafhankelijke basisnaam: "Terminator 2: Judgment Day" →
 * "Terminator", "Super Mario Bros. 3" → "Super Mario Bros", "Shrek the
 * Third" blijft gewoon staan. Alleen voor films, series, anime en games;
 * bij muziek hoort een nummer bij de titel ("Mambo No. 5").
 */
function basisNaam(naam) {
    let t = String(naam || '').trim();
    if (!t) return '';
    // Ondertitel weg: "X: Y", "X - Y", "X – Y".
    // Alleen als de hoofdtitel zelf herkenbaar genoeg is: "Star Wars: …"
    // wordt "Star Wars", maar "Mission: Impossible" blijft heel.
    const hoofd = t.split(/\s*[:–—]\s+|\s+-\s+/)[0].trim();
    const hoofdNorm = normaliseer(hoofd);
    if (hoofd !== t && (hoofdNorm.split(' ').length >= 2 || hoofdNorm.length >= 8)) t = hoofd;
    // Afsluitend volgnummer weg: 2..9, II..X, "Part 2", "Deel 3", "Chapter 4".
    const woorden = t.split(/\s+/);
    while (woorden.length > 1) {
        const laatste = woorden[woorden.length - 1].toLowerCase().replace(/[.,!]+$/, '');
        const voorlaatste = (woorden[woorden.length - 2] || '').toLowerCase();
        if (/^[2-9]$/.test(laatste) || ROMEINS.has(laatste)) {
            woorden.pop();
            if (['part', 'deel', 'chapter', 'hoofdstuk', 'episode', 'vol', 'vol.'].includes(voorlaatste)) woorden.pop();
            continue;
        }
        break;
    }
    const basis = woorden.join(' ').replace(/[.,]+$/, '').trim();
    return normaliseer(basis).length >= 4 ? basis : t;
}

/** Sleutel om dezelfde franchise/serie te herkennen (meerkeuze-afleiders). */
function franchiseSleutel(titel) {
    if (!titel) return '';
    if (MUZIEK.has(titel.categorie || titel.type)) return normaliseer(titel.naam);
    return normaliseer(titel.franchise || basisNaam(titel.naam));
}

function score(g, kandidaat) {
    const genorm = normaliseer(kandidaat);
    if (!genorm) return 0;
    // Dice op bigrams, aangevuld met Levenshtein-gelijkenis zodat een
    // enkele typefout (bv. "zwarboek") ook slaagt. De hoogste telt.
    return Math.max(dice(g, genorm), levGelijkenis(g, genorm));
}

/**
 * Vergelijk een gok met een titel, zijn aliassen en (voor films, series,
 * anime en games) de franchise. "Terminator" is dus goed bij Terminator 2,
 * en "Super Mario" bij Super Mario Bros. 3.
 *
 * @param {string} gok
 * @param {{naam: string, aliassen?: string[], franchise?: string, categorie?: string, type?: string}} titel
 * @returns {{score: number, status: 'goed'|'bijna'|'fout'}}
 */
function vergelijk(gok, titel) {
    const g = normaliseer(gok);
    if (!g) return { score: 0, status: 'fout' };

    const versieVrij = !MUZIEK.has(titel.categorie || titel.type);
    const kandidaten = [titel.naam, ...(titel.aliassen || [])];
    if (versieVrij) {
        if (titel.franchise) kandidaten.push(titel.franchise);
        kandidaten.push(basisNaam(titel.naam));
    }
    const gokken = [g];
    if (versieVrij) {
        const gb = normaliseer(basisNaam(gok));
        if (gb && gb !== g && gb.length >= 4) gokken.push(gb);
    }

    let beste = 0;
    for (const kandidaat of kandidaten) {
        if (!kandidaat) continue;
        for (const variant of gokken) {
            const s = score(variant, kandidaat);
            if (s > beste) beste = s;
        }
    }

    // Begin van de titel is ook goed bij een duidelijke franchisenaam:
    // "super mario" bij "super mario bros 3", "terminator" bij
    // "terminator 2 judgment day". Kort en algemeen ("star") telt niet.
    if (versieVrij && beste < DREMPEL_GOED) {
        const doel = normaliseer(titel.naam);
        const compact = g.replace(/\s+/g, '');
        if (doel.startsWith(g + ' ') && compact.length >= 8
            && compact.length / doel.replace(/\s+/g, '').length >= 0.35) {
            beste = Math.max(beste, DREMPEL_GOED);
        }
    }

    let status = 'fout';
    if (beste >= DREMPEL_GOED) status = 'goed';
    else if (beste >= DREMPEL_BIJNA) status = 'bijna';

    return { score: beste, status };
}

module.exports = {
    normaliseer,
    dice,
    vergelijk,
    basisNaam,
    franchiseSleutel,
    DREMPEL_GOED,
    DREMPEL_BIJNA,
};
