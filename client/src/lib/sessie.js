// =====================================================================
// Sessie-opslag in de browser. Bewaart per lobby het sessie-token zodat
// een speler na het sluiten en heropenen van de app terugkeert zonder
// punten te verliezen (herstel na disconnect).
// =====================================================================

const SLEUTEL = 'ventune_sessie';

/** Bewaar de sessie voor de huidige lobby. */
export function bewaarSessie(sessie) {
    try {
        localStorage.setItem(SLEUTEL, JSON.stringify(sessie));
    } catch {
        /* localStorage kan geblokkeerd zijn; niet fataal. */
    }
}

/** Lees de bewaarde sessie (of null). */
export function leesSessie() {
    try {
        const ruw = localStorage.getItem(SLEUTEL);
        return ruw ? JSON.parse(ruw) : null;
    } catch {
        return null;
    }
}

/** Wis de sessie (bij verlaten of afgelopen lobby). */
export function wisSessie() {
    try {
        localStorage.removeItem(SLEUTEL);
    } catch {
        /* negeren */
    }
}
