// =====================================================================
// Sessie-opslag in de browser. Bewaart per lobby het sessie-token zodat
// een speler na het sluiten en heropenen van de app terugkeert zonder
// punten te verliezen (herstel na disconnect).
// =====================================================================

const SLEUTEL = 'ventune_sessie';
const HISTORIE = 'ventune_spellen_lokaal';

/** Onderbroken spellen op dit apparaat (maximaal acht). */
export function leesOpgeslagenSpellen() {
    try {
        const opgeslagen = JSON.parse(localStorage.getItem(HISTORIE) || '[]');
        return Array.isArray(opgeslagen) ? opgeslagen.filter(x=>x?.token&&x?.code).slice(0,8) : [];
    } catch { return []; }
}

export function verwijderOpgeslagenSpel(code) {
    try { localStorage.setItem(HISTORIE,JSON.stringify(leesOpgeslagenSpellen().filter(x=>x.code!==code))); }
    catch { /* lokale opslag optioneel */ }
}


/** Bewaar de sessie voor de huidige lobby. */
export function bewaarSessie(sessie) {
    try {
        localStorage.setItem(SLEUTEL, JSON.stringify(sessie));
        if (sessie?.token && sessie?.code) {
            const oud = leesOpgeslagenSpellen().filter(x=>x.code!==sessie.code);
            localStorage.setItem(HISTORIE, JSON.stringify([{...sessie,laatstGezien:Date.now()},...oud].slice(0,8)));
        }
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
