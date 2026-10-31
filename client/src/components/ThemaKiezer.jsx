import React, { useState } from 'react';
import { LOOKS, leesLook, zetLook } from '../lib/looks.js';

// Kleine themakiezer: drie knoppen (Neon / Noir / Kerst). De keuze blijft
// bewaard in de browser en past meteen de hele app aan.
export default function ThemaKiezer() {
    const [actief, setActief] = useState(leesLook());

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
        </div>
    );
}
