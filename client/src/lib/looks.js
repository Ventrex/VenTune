// =====================================================================
// Thema-keuze (het "uiterlijk" van VenTune). Elk thema verandert kleuren,
// lettertype en vormen; zie styles/themes.css.
//
// De keuze staat in localStorage en wordt als data-thema op <html> gezet.
// Oude thema-namen (laser, retro, game) worden omgezet naar de nieuwe.
// =====================================================================

const SLEUTEL = 'ventune_look';
const STANDAARD = 'studio';

export const LOOKS = [
    { id: 'studio', naam: 'Studio', voorbeeld: ['#121212', '#ff5a36', '#f2f0eb'] },
    { id: 'noir', naam: 'Bioscoop', voorbeeld: ['#000000', '#c41230', '#f5f5f5'] },
    { id: 'papier', naam: 'Krant', voorbeeld: ['#f1ece1', '#1a1a1a', '#ff8a7a'] },
    { id: 'arcade', naam: 'Arcade', voorbeeld: ['#050505', '#ffe600', '#2e8bff'] },
    { id: 'disco', naam: "Disco '70", voorbeeld: ['#2a1810', '#f4a024', '#c2185b'] },
    { id: 'neon', naam: 'Neon', voorbeeld: ['#0a0618', '#ff2d95', '#00e5ff'] },
    { id: 'kerst', naam: 'Kerst', voorbeeld: ['#0b231b', '#e24b3b', '#f0c969'] },
    { id: 'sinterklaas', naam: 'Sinterklaas', voorbeeld: ['#5a0c13', '#f5c542', '#fff4dc'] },
];

const OUD = { laser: 'neon', retro: 'disco', game: 'arcade' };

export function leesLook() {
    try {
        let v = localStorage.getItem(SLEUTEL);
        if (OUD[v]) v = OUD[v];
        return LOOKS.some((l) => l.id === v) ? v : STANDAARD;
    } catch {
        return STANDAARD;
    }
}

export function zetLook(id) {
    const geldig = LOOKS.some((l) => l.id === id) ? id : STANDAARD;
    try { localStorage.setItem(SLEUTEL, geldig); } catch { /* */ }
    document.documentElement.setAttribute('data-thema', geldig);
    for (const v of ['--bg', '--surface', '--red-hot', '--red', '--accent']) document.documentElement.style.removeProperty(v);
    try { localStorage.removeItem('ventune_custom_active'); } catch { /* */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    const look = LOOKS.find((l) => l.id === geldig);
    if (meta && look) meta.setAttribute('content', look.voorbeeld[0]);
    return geldig;
}

/** Pas het bewaarde thema toe op <html> (bij het opstarten). */
export function pasToegepastThemaToe() {
    const look = leesLook();
    document.documentElement.setAttribute('data-thema', look);
    document.documentElement.removeAttribute('data-achtergrond');
    const meta = document.querySelector('meta[name="theme-color"]');
    const gevonden = LOOKS.find((l) => l.id === look);
    if (meta && gevonden) meta.setAttribute('content', gevonden.voorbeeld[0]);
}
