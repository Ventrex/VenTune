import React, { useState } from 'react';
import { LOOKS, leesLook, zetLook } from '../lib/looks.js';

// Thema kiezen: elk thema verandert kleuren, letters en vormen.
export default function ThemaKiezer() {
    const [actief, setActief] = useState(leesLook);
    return (
        <div className="vt-themas" role="radiogroup" aria-label="Thema">
            {LOOKS.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={actief === l.id}
                    className={'vt-thema-tegel' + (actief === l.id ? ' actief' : '')}
                    data-voorbeeld={l.id}
                    onClick={() => setActief(zetLook(l.id))}>
                    <span className="vt-thema-staal" style={{ background: l.voorbeeld[0] }}>
                        <i style={{ background: l.voorbeeld[1] }} /><i style={{ background: l.voorbeeld[2] }} />
                    </span>
                    <span>{l.naam}</span>
                </button>
            ))}
        </div>
    );
}
