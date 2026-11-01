import React, { useEffect, useState } from 'react';
import { leesLook, zetLook, LOOKS } from '../lib/looks.js';

const ACHTERGRONDEN = [
    ['standaard','Standaard'],['neon','Neon'],['bioscoop','Bioscoop'],
    ['retro','Retro 80’s'],['game','Game'],['kerst','Kerst'],
    ['winters','Winters'],['space','Space'],['natuur','Natuur'],
    ['donker','Donker'],['licht','Licht']
];
const LETTERS = [['montserrat','Montserrat'],['poppins','Poppins'],['roboto','Roboto']];
function bewaar(sleutel, waarde, attribuut) {
    try { localStorage.setItem(sleutel, waarde); } catch { /* privacy mode */ }
    document.documentElement.setAttribute(attribuut, waarde);
}
export default function UiterlijkOpties() {
    const [achtergrond, setAchtergrond] = useState(() => {
        try { return localStorage.getItem('ventune_achtergrond') || 'standaard'; }
        catch { return 'standaard'; }
    });
    const [letter, setLetter] = useState(() => {
        try { return localStorage.getItem('ventune_lettertype') || 'montserrat'; }
        catch { return 'montserrat'; }
    });
    const [look, setLook] = useState(leesLook);
    useEffect(() => {
        document.documentElement.setAttribute('data-achtergrond', achtergrond);
        document.documentElement.setAttribute('data-lettertype', letter);
    }, [achtergrond, letter]);
    function kiesAchtergrond(id) {
        setAchtergrond(id);
        bewaar('ventune_achtergrond', id, 'data-achtergrond');
        if (LOOKS.some(x => x.id === id)) setLook(zetLook(id));
    }
    function kiesLetter(id) {
        setLetter(id);
        bewaar('ventune_lettertype', id, 'data-lettertype');
    }
    return <div className="vt-opties-onder">
        <section className="vt-achtergrond-kiezer" aria-label="Achtergronden">
            <h3>Beschikbare thema’s / achtergronden</h3>
            <div className="vt-achtergrond-lijst">{ACHTERGRONDEN.map(([id, naam]) =>
                <button key={id} type="button" className={'vt-achtergrond-tile vt-bg-'+id + (achtergrond===id?' gekozen':'')}
                    aria-pressed={achtergrond===id} onClick={() => kiesAchtergrond(id)}>
                    <span className="vt-bg-preview" aria-hidden="true">{id==='game'?'♟':id==='kerst'?'❄':id==='space'?'✦':id==='bioscoop'?'▥':''}</span>
                    <span>{naam}</span>{achtergrond===id&&<b className="vt-achtergrond-check">✓</b>}
                </button>)}</div>
        </section>
        <section className="vt-font-kiezer" aria-label="Lettertypes">
            <h3>Lettertype opties</h3>
            <div className="vt-font-lijst">{LETTERS.map(([id, naam]) =>
                <button key={id} type="button" className={'vt-font-tile'+(letter===id?' gekozen':'')} aria-pressed={letter===id} onClick={()=>kiesLetter(id)}>
                    <b>Aa</b><span>{naam}</span>{letter===id&&<i>✓</i>}
                </button>)}</div>
        </section>
    </div>;
}
