import React from 'react';

// Pulserende balkenreeks in rood — puur CSS-animatie (geen audio-analyse,
// die is er niet bij preview-playback). Verbergt de titel: je ziet alleen
// beweging, geen hoes of naam.
export default function Visualizer({ actief = true }) {
    const balken = Array.from({ length: 9 });
    return (
        <div className={'visualizer' + (actief ? '' : ' stil')} aria-hidden="true">
            {balken.map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.09}s` }} />
            ))}
        </div>
    );
}
