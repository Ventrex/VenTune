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
    { id: 'neon', naam: 'Standaard', emoji: '◉' },
    { id: 'laser', naam: 'Neon', emoji: '╱' },
    { id: 'noir', naam: 'Bioscoop', emoji: '▥' },
    { id: 'retro', naam: 'Retro 80’s', emoji: '▤' },
    { id: 'game', naam: 'Game', emoji: '✦' },
    { id: 'kerst', naam: 'Kerst', emoji: '❄' },
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
    try {
        const achtergrond = localStorage.getItem('ventune_achtergrond');
        const lettertype = localStorage.getItem('ventune_lettertype');
        if (achtergrond) document.documentElement.setAttribute('data-achtergrond', achtergrond);
        if (lettertype) document.documentElement.setAttribute('data-lettertype', lettertype);
        if (localStorage.getItem('ventune_custom_active') === 'true') {
            const kleuren = JSON.parse(localStorage.getItem('ventune_eigen_kleuren') || '{}');
            for (const [sleutel, waarde] of Object.entries({ '--bg': kleuren.achtergrond, '--surface': kleuren.paneel, '--red-hot': kleuren.accent, '--red': kleuren.accent })) {
                if (/^#[0-9a-fA-F]{6}$/.test(waarde || '')) document.documentElement.style.setProperty(sleutel, waarde);
            }
        }
    } catch { /* localStorage optioneel */ }
}
