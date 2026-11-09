import React, { useEffect, useState } from 'react';
import TopNav from '../components/TopNav.jsx';
import Hint from '../components/Hint.jsx';
import { haalRanking } from '../lib/api.js';
import './setup-categorie.css';
import './scores.css';

// Scores: algemeen én per categorie (wie is de beste in videogames,
// films, series, anime, muziek).
const TABS = [
    ['algemeen', 'Algemeen'], ['film', 'Films'], ['serie', 'Series'], ['anime', 'Anime'],
    ['game', 'Videogames'], ['muziek', 'Muziek'],
];

export default function Scores() {
    const [tab, setTab] = useState('algemeen');
    const [ranking, setRanking] = useState(null);
    const [perCat, setPerCat] = useState(null);
    useEffect(() => {
        haalRanking().then(setRanking).catch(() => setRanking({}));
        fetch('/api/scores/categorieen').then((r) => r.json()).then(setPerCat).catch(() => setPerCat({}));
    }, []);

    return (
        <main className="scherm ventune-home vt-scores">
            <TopNav actief="scores" />
            <h1>Scores</h1>
            <div className="vt-scores-tabs" role="tablist">
                {TABS.map(([id, naam]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id}
                        className={'chip' + (tab === id ? ' gekozen' : '')} onClick={() => setTab(id)}>{naam}</button>
                ))}
            </div>
            {tab === 'algemeen'
                ? <Algemeen ranking={ranking} />
                : <PerCategorie lijst={perCat?.[tab]} laden={!perCat} naam={TABS.find((t) => t[0] === tab)[1]} />}
        </main>
    );
}

function Algemeen({ ranking }) {
    if (!ranking) return <p className="dim">Laden…</p>;
    const blokken = [
        ['Beste gemiddelde per spel', 'gemiddelde', ' pnt', ranking.beste_gemiddeld, 'Gemiddelde eindscore per afgerond spel.'],
        ['Meeste punten per ronde', 'punten_gemiddeld', ' pnt', ranking.punten_gemiddeld, 'Punten per vraag: zo tellen korte en eindeloze spellen eerlijk mee.'],
        ['Meeste spellen', 'spellen', '', ranking.meeste_spellen, 'Aantal afgeronde spellen.'],
    ];
    return (
        <div className="vt-scores-blokken">
            {blokken.map(([titel, veld, suffix, lijst = [], uitleg]) => (
                <section className="kaart vt-scores-blok" key={titel}>
                    <p className="kaart-label">{titel} <Hint tekst={uitleg} /></p>
                    {!lijst.length ? <p className="dim">Nog geen resultaten</p> : (
                        <ol className="vt-scores-lijst">
                            {lijst.slice(0, 10).map((r, i) => (
                                <li key={r.sleutel || r.naam}>
                                    <span className="vt-scores-plek">{i + 1}</span>
                                    <span className="vt-scores-naam">{r.naam}</span>
                                    <strong>{Number(r[veld] || 0).toFixed(veld === 'spellen' ? 0 : 1)}{suffix}</strong>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            ))}
        </div>
    );
}

function PerCategorie({ lijst, laden, naam }) {
    if (laden) return <p className="dim">Laden…</p>;
    if (!lijst?.length) return <p className="dim">Nog geen gespeelde rondes met {naam.toLowerCase()}.</p>;
    return (
        <section className="kaart vt-scores-blok vt-scores-breed">
            <p className="kaart-label">Beste in {naam.toLowerCase()} <Hint tekst="Gerangschikt op percentage goed (vanaf 5 rondes), daarna op punten per ronde." /></p>
            <ol className="vt-scores-lijst">
                <li className="vt-scores-kop" aria-hidden="true"><span /><span>Speler</span><span>Goed</span><span>Pnt/ronde</span><span>Rondes</span></li>
                {lijst.map((r, i) => (
                    <li key={r.sleutel}>
                        <span className="vt-scores-plek">{i === 0 ? '🏆' : i + 1}</span>
                        <span className="vt-scores-naam">{r.avatar_url && <img src={r.avatar_url} alt="" />}{r.naam}</span>
                        <strong>{r.procent}%</strong>
                        <span>{Number(r.punten_per_ronde || 0).toFixed(1)}</span>
                        <span className="dim">{r.rondes}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
}
