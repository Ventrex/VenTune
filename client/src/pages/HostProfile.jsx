import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import ThemaKiezer from '../components/ThemaKiezer.jsx';
import UiterlijkOpties from '../components/UiterlijkOpties.jsx';
import './setup-categorie.css';
import { authBewaarProfiel, authProfiel } from '../lib/api.js';

// Compact hostprofiel: accountstatus, spelhistorie en eigen presets op één
// plek. Uitloggen staat bewust niet prominent; een host blijft aangemeld.
export default function HostProfile() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [naam, setNaam] = useState('');
    const [geboortedatum, setGeboortedatum] = useState('');
    const [email,setEmail]=useState('');
    const [avatarFile,setAvatarFile]=useState(null);
    const [huidigWachtwoord,setHuidigWachtwoord]=useState('');
    const [nieuwWachtwoord,setNieuwWachtwoord]=useState('');
    const [bezigAccount,setBezigAccount]=useState(false);

    const [fout, setFout] = useState('');
    const [melding, setMelding] = useState('');

    useEffect(() => {
        authProfiel().then((resultaat) => {
            setData(resultaat);
            setNaam(resultaat.profiel.display_naam);
            setEmail(resultaat.profiel.email||'');
            setGeboortedatum(resultaat.profiel.geboortedatum ? String(resultaat.profiel.geboortedatum).slice(0, 10) : '');
        }).catch((err) => {
            if (/inlog/i.test(err.message)) navigate('/host/login?return=/host/profile', { replace: true });
            else setFout(err.message);
        });
    }, [navigate]);

    async function bewaar(e) {
        e.preventDefault();
        setFout('');
        setMelding('');
        try {
            const resultaat = await authBewaarProfiel({ display_naam: naam, geboortedatum: geboortedatum || null, email });
            setData((oud) => ({ ...oud, profiel: { ...oud.profiel, ...resultaat } }));
            setMelding('Profiel opgeslagen.');
        } catch (err) { setFout(err.message); }
    }

    async function uploadAvatar(e){
        e.preventDefault();if(!avatarFile)return;
        setBezigAccount(true);setFout('');setMelding('');
        try{
            const form=new FormData();form.append('afbeelding',avatarFile);
            const r=await fetch('/api/auth/avatar',{method:'POST',credentials:'include',body:form});
            const data=await r.json().catch(()=>({}));
            if(!r.ok)throw Error(data.fout||(r.status===413?'Afbeelding is te groot voor de server (max. 5 MB).':`Avatar upload mislukt (fout ${r.status}).`));
            setData(v=>({...v,profiel:{...v.profiel,avatar_url:data.avatar_url}}));
            setAvatarFile(null);setMelding('Avatar opgeslagen.');
        }catch(err){setFout(err.message)}finally{setBezigAccount(false)}
    }
    async function wijzigWachtwoord(e){
        e.preventDefault();setFout('');
        setBezigAccount(true);
        try{
            const r=await fetch('/api/auth/wachtwoord-wijzigen',{
                method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({huidig:huidigWachtwoord,nieuw:nieuwWachtwoord})
            });
            const data=await r.json().catch(()=>({}));
            if(!r.ok)throw Error(data.fout||'Wachtwoord veranderen mislukt');
            setHuidigWachtwoord('');setNieuwWachtwoord('');
            navigate('/host/login?return=/host/profile',{replace:true});
        }catch(err){setFout(err.message)}finally{setBezigAccount(false)}
    }

    return (
        <main className="scherm">
            <Brand compact />
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <Link className="terug" to="/setup">← Terug naar setup</Link>
            </p>
            <h1>Mijn profiel</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            {!data && !fout && <p className="dim">Profiel laden…</p>}
            {data && (
                <>
                    <form className="kaart stapel" onSubmit={bewaar}>
                        <p className="kaart-label">Account</p>
                        <div className="cw-profile-head">
                            {data.profiel.avatar_url?<img className="cw-profile-avatar" src={data.profiel.avatar_url} alt="Profielfoto"/>:
                              <span className="cw-profile-avatar cw-profile-placeholder">{data.profiel.display_naam?.[0]?.toUpperCase()||'♫'}</span>}
                            <span><strong>{data.profiel.display_naam}</strong><small>@{data.profiel.gebruikersnaam} · {data.profiel.actief?'actief':'uitgeschakeld'}</small></span>
                        </div>
                        <small className="dim">Je accountnaam blijft vast. Je zichtbare naam kun je wijzigen als die nog vrij is.</small>
                        <label className="kaart-label" htmlFor="profiel-naam">Naam op het hostscherm</label>
                        <input id="profiel-naam" className="invoer" value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={40} required />
                        <label className="kaart-label" htmlFor="profiel-email">E-mailadres (optioneel)</label>
                        <input id="profiel-email" className="invoer" type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="Je e-mailadres"/>
                        <label className="kaart-label" htmlFor="profiel-geboorte">Geboortedatum</label>
                        <input id="profiel-geboorte" className="invoer" type="date" value={geboortedatum} onChange={(e) => setGeboortedatum(e.target.value)} />
                        <p className="dim" style={{ marginTop: '-0.75rem' }}>
                            {data.profiel.leeftijd ? `Leeftijd: ${data.profiel.leeftijd} jaar. Dit gebruikt VenTune automatisch voor host/gezinsinstellingen.` : 'Geen geboortedatum ingevuld; leeftijd blijft onbekend.'}
                        </p>
                        <button className="knop" type="submit">Opslaan</button>
                        {melding && <p className="dim">{melding}</p>}
                    </form>
                    <section className="kaart cw-profile-security" style={{marginTop:'1rem'}}>
                        <h2>Avatar en beveiliging</h2>
                        <form className="cw-profile-row" onSubmit={uploadAvatar}>
                            <label>Profielfoto <small>PNG, JPG of WebP · max. 5 MB</small>
                                <input className="invoer" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setAvatarFile(e.target.files?.[0]||null)}/>
                            </label>
                            <button className="knop knop-stil" type="submit" disabled={!avatarFile||bezigAccount}>Avatar opslaan</button>
                        </form>
                        <form className="cw-profile-row" onSubmit={wijzigWachtwoord}>
                            <label>Huidig wachtwoord<input className="invoer" type="password" value={huidigWachtwoord} onChange={e=>setHuidigWachtwoord(e.target.value)} autoComplete="current-password" required/></label>
                            <label>Nieuw wachtwoord<input className="invoer" type="password" value={nieuwWachtwoord} onChange={e=>setNieuwWachtwoord(e.target.value)} autoComplete="new-password" minLength={10} required/></label>
                            <button type="submit" className="knop knop-stil" disabled={bezigAccount||nieuwWachtwoord.length<10}>Wachtwoord wijzigen</button>
                        </form>
                    </section>
                    <div className="overzicht" style={{ marginTop: '1rem' }}>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.spellen}</span><span className="tegel-label">Spellen</span></div>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.punten}</span><span className="tegel-label">Punten</span></div>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.beste_score}</span><span className="tegel-label">Beste score</span></div>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.gemiddelde_score||0}</span><span className="tegel-label">Gemiddelde</span></div>
                    </div>
                    <section className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <p className="kaart-label">Eigen presets ({data.presets.length})</p>
                        {data.presets.length ? <ul className="spelerlijst">{data.presets.map((preset) => <li className="speler-kaart" key={preset.id}><span>{preset.naam}</span><span className="dim">{preset.rondes === 0 ? 'eindeloos' : `${preset.rondes} rondes`}</span></li>)}</ul> : <p className="dim">Nog geen eigen presets.</p>}
                    </section>
                    <section className="kaart vt-profiel-appearance" style={{ marginTop: '1rem', textAlign: 'left' }}><h2>Thema & uiterlijk</h2><p className="dim">Kies jouw eigen achtergrond en lettertype.</p><ThemaKiezer/><UiterlijkOpties/></section>
                    <section className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <p className="kaart-label">Recente spellen</p>
                        {data.spellen.length ? <ul className="spelerlijst">{data.spellen.map((spel) => <li className="speler-kaart" key={`${spel.code}-${spel.bijgewerkt_op}`}><span>Lobby {spel.code}</span><span className="dim">{spel.spelers} spelers · beste {spel.hoogste_score}</span></li>)}</ul> : <p className="dim">Nog geen afgeronde spellen.</p>}
                    </section>
                </>
            )}
        </main>
    );
}
