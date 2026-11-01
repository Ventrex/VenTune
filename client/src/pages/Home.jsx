import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { haalRanking } from '../lib/api.js';
import Brand from '../components/Brand.jsx';
import Icon from '../components/Icon.jsx';
import { leesSessie, wisSessie } from '../lib/sessie.js';
import './setup-categorie.css';
import { ThemaContext } from '../lib/thema.js';

// Startscherm: nieuw spel maken (host) of meedoen met een code.
export default function Home() {
    const navigate = useNavigate();
    const thema = useContext(ThemaContext);
    const [code, setCode] = useState('');
    const [vorigeSessie, setVorigeSessie] = useState(leesSessie);
    const [fout, setFout] = useState('');
    const [ranking, setRanking] = useState({
        beste_gemiddeld: [],
        meeste_spellen: [],
        punten_gemiddeld: [],
    });

    // Ranglijst over eerdere spellen.
    useEffect(() => {
        haalRanking().then(setRanking).catch(() => {});
    }, []);

    function nieuwSpel() {
        // Een host moet eerst een account hebben; het account-scherm stuurt
        // ingelogde hosts direct door naar het filtermenu.
        navigate('/host/login?return=/setup/new');
    }

    function meedoen(e) {
        e.preventDefault();
        const schoon = code.trim().toUpperCase();
        if (schoon.length !== 4) {
            setFout('Een lobbycode bestaat uit 4 letters.');
            return;
        }
        navigate(`/join/${schoon}`);
    }

    return (
        <main className="scherm ventune-home">
            <Brand link={false} />
            <header className="vt-home-hero">
                <h1>Kies je volgende quiz</h1>
                <p>Start een nieuw spel, doe mee met vrienden of ga verder waar je was gebleven.</p>
            </header>
            {fout && <p className="waarschuwing">{fout}</p>}
            <div className="vt-home-actions">
                <button type="button" className="vt-home-action vt-home-new" onClick={nieuwSpel}>
                    <img src="/category/approved-films.svg?v=hd840-20261101" alt="" />
                    <span><strong>Nieuw spel</strong><small>Stel je quiz samen</small></span>
                </button>
                <form onSubmit={meedoen} className="vt-home-action vt-home-join">
                    <div className="vt-home-action-heading"><span className="vt-option-art">📱</span><strong>Spel joinen</strong><small>Voer de lobbycode in</small></div>
                    <div className="zoekbalk">
                        <input className="invoer code-invoer" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
                            placeholder="ABCD" maxLength={4} autoCapitalize="characters" aria-label="Lobbycode"/>
                        <button className="knop" type="submit">Joinen</button>
                    </div>
                </form>
                <div className="vt-home-action vt-home-continue">
                    <div className="vt-home-action-heading"><span className="vt-option-art">↻</span><strong>Doorgaan vorig spel</strong>
                        <small>{vorigeSessie?.code ? 'Lobby '+vorigeSessie.code : 'Geen onderbroken spel op dit apparaat'}</small></div>
                    <button className="knop knop-stil" type="button" disabled={!vorigeSessie?.token} onClick={()=>navigate(vorigeSessie?.is_host?'/host':'/play')}>Doorgaan</button>
                    {vorigeSessie?.code && <button type="button" className="terug als-link" onClick={()=>{wisSessie();setVorigeSessie(null)}}>Oude sessie wissen</button>}
                </div>
            </div>
            {(ranking.beste_gemiddeld?.length > 0 || ranking.meeste_spellen?.length > 0 || ranking.punten_gemiddeld?.length > 0) && (
                <div style={{ marginTop: '2.5rem' }}>
                    <p className="kaart-label" style={{ textAlign: 'left' }}>
                        Topscores
                    </p>
                    <div className="ranking-blokken">
                        <RankingBlok titel="Beste gemiddelde per spel" veld="gemiddelde" suffix=" pnt" lijst={ranking.beste_gemiddeld} />
                        <RankingBlok titel="Meeste spellen" veld="spellen" suffix=" spel" lijst={ranking.meeste_spellen} />
                        <RankingBlok titel="Meeste punten gemiddeld" veld="punten_gemiddeld" suffix=" pnt/ronde" lijst={ranking.punten_gemiddeld} />
                    </div>
                </div>
            )}

            <p style={{ marginTop: '1rem', display: 'flex', gap: '1.25rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link className="terug" to="/changelog">
                    Wat is nieuw? →
                </Link>
                <Link className="terug" to="/admin">
                    Beheer →
                </Link>
                <Link className="terug" to="/admin/ai">
                    AI &amp; aanbevelingen →
                </Link>
            </p>

        </main>
    );
}

function RankingBlok({ titel, veld, suffix, lijst = [] }) {
    return (
        <section className="kaart ranking-blok">
            <p className="kaart-label">{titel}</p>
            {lijst.length === 0 ? <p className="dim">Nog geen resultaten</p> : (
                <ol className="ranking-lijst">
                    {lijst.slice(0, 5).map((r) => (
                        <li key={`${titel}-${r.sleutel || r.naam}`}>
                            <span>{r.naam}</span>
                            <strong>{Number(r[veld] || 0).toFixed(veld === 'spellen' ? 0 : 1)}{suffix}</strong>
                        </li>
                    ))}
                </ol>
            )}
            <p className="dim ranking-uitleg">Gebaseerd op {lijst[0]?.spellen || 0} gespeelde spellen; punten/ronde maakt 10 vragen en eindeloos eerlijk vergelijkbaar.</p>
        </section>
    );
}
