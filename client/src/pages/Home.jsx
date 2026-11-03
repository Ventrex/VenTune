import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { haalRanking, authSessie } from '../lib/api.js';
import Brand from '../components/Brand.jsx';
import Icon from '../components/Icon.jsx';
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
    const [hostAccount,setHostAccount]=useState(null);
    const [isAdmin,setIsAdmin]=useState(false);
    const [siteTeksten,setSiteTeksten]=useState({});
    const kop=(sleutel,standaard)=>siteTeksten[sleutel]||standaard;
    useEffect(()=>{
        fetch('/api/site-teksten').then(r=>r.ok?r.json():{}).then(setSiteTeksten).catch(()=>{});
    },[]);

    useEffect(()=>{
        authSessie().then(d=>setHostAccount(d.ingelogd?d.gebruiker:null)).catch(()=>setHostAccount(null));
        fetch('/api/admin/sessie',{credentials:'include'}).then(r=>r.ok?r.json():{ingelogd:false})
            .then(d=>setIsAdmin(d.ingelogd===true)).catch(()=>setIsAdmin(false));
    },[]);

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
            <nav className="vt-category-topnav vt-home-topnav" aria-label="VenTune navigatie">
                <Link className="vt-top-brand" to="/setup"><img className="vt-top-equalizer" src="/category/equalizer.svg" alt=""/><strong><span>Ven</span>Tune</strong></Link>
                <div className="vt-top-links">
                    <Link className="vt-top-active" to="/setup"><img src="/category/icon-game.svg" alt=""/>{kop("nav.spelen","Spelen")}</Link>
                    <Link to="/"><img src="/category/icon-trophy.svg" alt=""/>{kop("nav.scores","Scores")}</Link>
                    {(isAdmin || hostAccount?.rol==='beoordelaar') && <Link to={isAdmin?'/admin/swipe':'/review'}><img src="/category/icon-play.svg" alt=""/>{kop("nav.controleren","Controleren")}</Link>}
                    {isAdmin && <Link to="/admin"><img src="/category/icon-settings.svg" alt=""/>{kop("nav.beheer","Beheer")}</Link>}
                    {(isAdmin || (hostAccount && hostAccount.rol!=='beoordelaar')) && <Link to={hostAccount?'/host/profile':'/host/login?return=/host/profile'}><img src="/category/icon-users.svg" alt=""/>{kop("nav.profielen","Profielen")}</Link>}
                </div>
                <Link className="vt-top-user" to={hostAccount?'/host/profile':isAdmin?'/admin':'/host/login?return=/host/profile'}>
                    <span className="vt-avatar-ring">{hostAccount?.avatar_url
                        ? <img src={hostAccount.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                        : hostAccount?.display_naam?.slice(0,1).toUpperCase() || '♫'}</span>
                    {hostAccount?.display_naam || (isAdmin ? 'Beheerder' : kop('nav.inloggen','Inloggen'))}
                </Link>
            </nav>
            <header className="vt-home-hero">
                <h1>{kop("home.titel","Kies je volgende quiz")}</h1>
                <p>{kop("home.ondertitel","Start een nieuw spel, doe mee met vrienden of ga verder waar je was gebleven.")}</p>
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
                {isAdmin && <Link className="terug" to="/admin">Beheer</Link>}
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
