import React, { useEffect, useRef, useState } from 'react';

// Uitleg niet als lap tekst op het scherm, maar achter een rondje:
//   soort="i"  informatie     ⓘ
//   soort="?"  vraag / hulp   ?
//   soort="!"  waarschuwing   !
// Tikken (of hoveren) toont de tekst; nog een keer tikken of ernaast sluit.
export default function Hint({ soort = 'i', tekst, children, label }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const dicht = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', dicht);
        return () => document.removeEventListener('pointerdown', dicht);
    }, [open]);
    const inhoud = children || tekst;
    if (!inhoud) return null;
    const naam = label || (soort === '!' ? 'Let op' : soort === '?' ? 'Uitleg' : 'Info');
    return (
        <span className={`vt-hint vt-hint-${soort === '!' ? 'let-op' : soort === '?' ? 'vraag' : 'info'}`} ref={ref}>
            <button type="button" className="vt-hint-knop" aria-label={naam} aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{soort}</button>
            {open && <span className="vt-hint-tekst" role="tooltip">{inhoud}</span>}
        </span>
    );
}
