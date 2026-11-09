import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import TopNav from '../components/TopNav.jsx';
import { leesSessie, wisSessie, bewaarSessie, leesOpgeslagenSpellen, verwijderOpgeslagenSpel } from '../lib/sessie.js';
import './setup-categorie.css';
import { ThemaContext } from '../lib/thema.js';

// Startscherm: nieuw spel maken (host) of meedoen met een code.
export default function Home() {
    const navigate = useNavigate();
    const thema = useContext(ThemaContext);
    const [code, setCode] = useState('');
    const [vorigeSessie, setVorigeSessie] = useState(leesSessie);
    const [opgeslagenSpellen, setOpgeslagenSpellen] = useState(leesOpgeslagenSpellen);
    const [fout, setFout] = useState('');
    const [siteTeksten,setSiteTeksten]=useState({});
    const kop=(sleutel,standaard)=>siteTeksten[sleutel]||standaard;
    useEffect(()=>{
        fetch('/api/site-teksten').then(r=>r.ok?r.json():{}).then(setSiteTeksten).catch(()=>{});
    },[]);



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
            <TopNav actief="home" teksten={siteTeksten} />
            <header className="vt-home-hero">
                <h1>{kop("home.titel","Kies je volgende quiz")}</h1>
                <p>{kop("home.ondertitel","Start een nieuw spel, doe mee met vrienden of ga verder waar je was gebleven.")}</p>
                <p><Link className="vt-aanvraag-link" to="/aanvragen">➕ Mis je iets? Voeg zelf een film, serie, game of nummer toe</Link></p>
            </header>
            {fout && <p className="waarschuwing">{fout}</p>}
            <div className="vt-home-actions">
                <button type="button" className="vt-home-action vt-home-new" onClick={nieuwSpel}>
                    <img src="/category/approved-films.svg?v=hd840-20261101" alt="" />
                    <span><strong>{kop("home.nieuw_spel","Nieuw spel")}</strong><small>Stel je quiz samen</small></span>
                </button>
                <form onSubmit={meedoen} className="vt-home-action vt-home-join">
                    <div className="vt-home-action-heading"><span className="vt-option-art">📱</span><strong>{kop("home.meedoen","Spel joinen")}</strong><small>Voer de lobbycode in</small></div>
                    <div className="zoekbalk">
                        <input className="invoer code-invoer" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
                            placeholder="ABCD" maxLength={4} autoCapitalize="characters" aria-label="Lobbycode"/>
                        <button className="knop" type="submit">Joinen</button>
                    </div>
                </form>
                <div className="vt-home-action vt-home-continue">
                    <div className="vt-home-action-heading"><span className="vt-option-art">↻</span><strong>{kop("home.doorgaan","Doorgaan vorig spel")}</strong>
                        <small>{opgeslagenSpellen.length ? 'Kies een eerder spel op dit apparaat':'Geen onderbroken spel op dit apparaat'}</small></div>
                    <div className="vt-saved-games">
                        {opgeslagenSpellen.map(opgeslagen=><div key={opgeslagen.code} className="vt-saved-game">
                            <button type="button" className="vt-saved-resume" onClick={()=>{
                                bewaarSessie(opgeslagen);
                                navigate(opgeslagen.is_host?'/host':'/play');
                            }}><strong>Lobby {opgeslagen.code}</strong><small>{opgeslagen.is_host?'Host':'Speler'} · opnieuw verbinden</small></button>
                            <button type="button" className="vt-saved-remove" aria-label={'Verwijder lobby '+opgeslagen.code} onClick={()=>{
                                verwijderOpgeslagenSpel(opgeslagen.code);
                                setOpgeslagenSpellen(leesOpgeslagenSpellen());
                                if(vorigeSessie?.code===opgeslagen.code){wisSessie();setVorigeSessie(null)}
                            }}>×</button>
                        </div>)}
                    </div>
                </div>
            </div>

            <p style={{ marginTop: '1rem', display: 'flex', gap: '1.25rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link className="terug" to="/changelog">Changelog →</Link>
            </p>

        </main>
    );
}

