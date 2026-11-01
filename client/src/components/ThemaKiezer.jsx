import React, { useState } from 'react';
import { LOOKS, leesLook, zetLook } from '../lib/looks.js';

const EIGEN_SLEUTEL = 'ventune_eigen_kleuren';
const STANDAARD = { achtergrond:'#0a0618', accent:'#ff2d95', paneel:'#160c33' };
function leesKleuren() {
    try { return {...STANDAARD, ...JSON.parse(localStorage.getItem(EIGEN_SLEUTEL) || '{}')}; }
    catch { return STANDAARD; }
}
function pasKleurenToe(kleuren) {
    const root = document.documentElement;
    root.style.setProperty('--bg', kleuren.achtergrond);
    root.style.setProperty('--surface', kleuren.paneel);
    root.style.setProperty('--red-hot', kleuren.accent);
    root.style.setProperty('--red', kleuren.accent);
}
export default function ThemaKiezer() {
    const [actief, setActief] = useState(leesLook);
    const [open, setOpen] = useState(false);
    const [kleuren, setKleuren] = useState(leesKleuren);
    function kies(id) {
        ['--bg','--surface','--red-hot','--red'].forEach(v => document.documentElement.style.removeProperty(v));
        setActief(zetLook(id));
        setOpen(false);
    }
    function kiesKleur(sleutel, kleur) {
        const volgende = {...kleuren,[sleutel]:kleur};
        setKleuren(volgende);
        try { localStorage.setItem(EIGEN_SLEUTEL, JSON.stringify(volgende)); localStorage.setItem('ventune_custom_active', 'true'); } catch { /* */ }
        pasKleurenToe(volgende);
    }
    return <div className="vt-thema-container">
        <div className="thema-kiezer" role="group" aria-label="Kies een uiterlijk">
            {LOOKS.map((l) => <button key={l.id} type="button"
                className={'thema-knop' + (actief===l.id && !open?' actief':'')}
                onClick={() => kies(l.id)} aria-pressed={actief===l.id && !open}>
                <span className="thema-emoji" aria-hidden="true">{l.emoji}</span>
                <span>{l.naam}</span>
            </button>)}
        </div>
        <button className="vt-eigen-thema" type="button" aria-expanded={open} onClick={() => setOpen(o=>!o)}>
            ✎ &nbsp; Eigen thema instellen
        </button>
        {open && <div className="vt-eigen-kleuren">
            {[['achtergrond','Achtergrond'],['paneel','Paneel'],['accent','Accentkleur']].map(([key,naam])=>
                <label key={key}><span>{naam}</span><input type="color" value={kleuren[key]}
                    onChange={e=>kiesKleur(key,e.target.value)}/></label>)}
        </div>}
    </div>;
}
