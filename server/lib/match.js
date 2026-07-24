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

/**
 * Vergelijk een gok met een titel en zijn aliassen.
 *
 * @param {string} gok
 * @param {{naam: string, aliassen?: string[]}} titel
 * @returns {{score: number, status: 'goed'|'bijna'|'fout'}}
 */
function vergelijk(gok, titel) {
    const g = normaliseer(gok);
    if (!g) return { score: 0, status: 'fout' };

    const kandidaten = [titel.naam, ...(titel.aliassen || [])];
    let beste = 0;
    for (const kandidaat of kandidaten) {
        const genorm = normaliseer(kandidaat);
        // Dice op bigrams, aangevuld met Levenshtein-gelijkenis zodat een
        // enkele typefout (bv. "zwarboek") ook slaagt. De hoogste telt.
        const score = Math.max(dice(g, genorm), levGelijkenis(g, genorm));
        if (score > beste) beste = score;
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
    DREMPEL_GOED,
    DREMPEL_BIJNA,
};
