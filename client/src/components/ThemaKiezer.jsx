import React, { useState } from 'react';
import { LOOKS, leesLook, zetLook, leesEigenKleuren, bewaarEigenKleuren } from '../lib/looks.js';

// Kleine themakiezer: drie knoppen (Neon / Noir / Kerst). De keuze blijft
// bewaard in de browser en past meteen de hele app aan.
export default function ThemaKiezer() {
    const [actief, setActief] = useState(leesLook());
    const [kleuren,setKleuren]=useState(leesEigenKleuren());

    function kies(id) {
        setActief(zetLook(id));
    }

    return (
        <div className="thema-kiezer" role="group" aria-label="Kies een uiterlijk">
            {LOOKS.map((l) => (
                <button
                    key={l.id}
                    type="button"
                    className={'thema-knop' + (actief === l.id ? ' actief' : '')}
                    onClick={() => kies(l.id)}
                    aria-pressed={actief === l.id}
                >
                    <span className="thema-emoji" aria-hidden="true">{l.emoji}</span>
                    <span>{l.naam}</span>
                </button>
            ))}
            {actief === 'eigen' && <div className="vt-eigen-kleuren" style={{display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'center',marginTop:'12px',width:'100%'}}>
                <label>Achtergrond <input type="color" value={kleuren.achtergrond} onChange={e=>{const x={...kleuren,achtergrond:e.target.value};setKleuren(x);bewaarEigenKleuren(x);}} /></label>
                <label>Accentkleur <input type="color" value={kleuren.accent} onChange={e=>{const x={...kleuren,accent:e.target.value};setKleuren(x);bewaarEigenKleuren(x);}} /></label>
            </div>}
        </div>
    );
}
