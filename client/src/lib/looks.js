// =====================================================================
// Thema-keuze (het "uiterlijk" van VenTune). Drie looks:
//   neon  — Neon Arcade (standaard)
//   noir  — OLED Noir
//   kerst — Kerst Cozy
//
// De keuze staat in localStorage en wordt als data-thema op <html> gezet;
// alle kleuren in theme.css volgen dat attribuut.
// =====================================================================

const SLEUTEL = 'ventune_look';
const STANDAARD = 'neon';

export const LOOKS = [
    { id: 'neon', naam: 'Neon Arcade', emoji: '🕹️' },
    { id: 'noir', naam: 'OLED Noir', emoji: '🎬' },
    { id: 'kerst', naam: 'Kerst Cozy', emoji: '🎄' },
];

export function leesLook() {
    try {
        const v = localStorage.getItem(SLEUTEL);
        return LOOKS.some((l) => l.id === v) ? v : STANDAARD;
    } catch {
        return STANDAARD;
    }
}

export function zetLook(id) {
    const geldig = LOOKS.some((l) => l.id === id) ? id : STANDAARD;
    try { localStorage.setItem(SLEUTEL, geldig); } catch { /* */ }
    document.documentElement.setAttribute('data-thema', geldig);
    return geldig;
}

/** Pas het bewaarde thema toe op <html> (bij het opstarten). */
export function pasToegepastThemaToe() {
    document.documentElement.setAttribute('data-thema', leesLook());
}
