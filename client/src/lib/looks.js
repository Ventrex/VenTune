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
    { id: 'eigen', naam: 'Eigen kleuren', emoji: '🎨' },
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
    pasEigenKleurenToe();
    return geldig;
}

/** Pas het bewaarde thema toe op <html> (bij het opstarten). */
export function pasToegepastThemaToe() {
    document.documentElement.setAttribute('data-thema', leesLook());
    pasEigenKleurenToe();
}

const KLEUR_SLEUTEL='ventune_eigen_kleuren';
export function leesEigenKleuren(){
    try { const x=JSON.parse(localStorage.getItem(KLEUR_SLEUTEL)||'{}');
      return {achtergrond:/^#[0-9a-f]{6}$/i.test(x.achtergrond)?x.achtergrond:'#100923',
        accent:/^#[0-9a-f]{6}$/i.test(x.accent)?x.accent:'#ff249d'}; }
    catch {return {achtergrond:'#100923',accent:'#ff249d'};}
}
function pasEigenKleurenToe(){
    const root=document.documentElement;
    const kleur=leesEigenKleuren();
    if(leesLook()==='eigen'){
       root.style.setProperty('--bg',kleur.achtergrond);
       root.style.setProperty('--surface',kleur.achtergrond);
       root.style.setProperty('--red-hot',kleur.accent);
       root.style.setProperty('--red',kleur.accent);
       root.style.setProperty('--accent',kleur.accent);
       root.style.setProperty('--kleur-accent',kleur.accent);
       root.style.backgroundColor=kleur.achtergrond;
    }else{
       root.style.removeProperty('--bg');
       root.style.removeProperty('--surface');
       root.style.removeProperty('--red-hot');
       root.style.removeProperty('--red');
       root.style.removeProperty('--accent');
       root.style.removeProperty('--kleur-accent');
       root.style.removeProperty('background-color');
    }
}
export function bewaarEigenKleuren(kleuren){
    const kleur={achtergrond:kleuren.achtergrond,accent:kleuren.accent};
    if(!Object.values(kleur).every(v=>/^#[0-9a-f]{6}$/i.test(v)))return;
    try{localStorage.setItem(KLEUR_SLEUTEL,JSON.stringify(kleur));}catch{}
    zetLook('eigen');
}
