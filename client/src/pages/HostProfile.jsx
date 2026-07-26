import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import { authBewaarProfiel, authProfiel } from '../lib/api.js';

// Compact hostprofiel: accountstatus, spelhistorie en eigen presets op één
// plek. Uitloggen staat bewust niet prominent; een host blijft aangemeld.
export default function HostProfile() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [naam, setNaam] = useState('');
    const [fout, setFout] = useState('');
    const [melding, setMelding] = useState('');

    useEffect(() => {
        authProfiel().then((resultaat) => {
            setData(resultaat);
            setNaam(resultaat.profiel.display_naam);
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
            const resultaat = await authBewaarProfiel({ display_naam: naam });
            setData((oud) => ({ ...oud, profiel: { ...oud.profiel, ...resultaat } }));
            setMelding('Profiel opgeslagen.');
        } catch (err) { setFout(err.message); }
    }

    return (
        <main className="scherm">
            <Brand compact />
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <Link className="terug" to="/setup">← Terug naar setup</Link>
            </p>
            <h1>Hostprofiel</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            {!data && !fout && <p className="dim">Profiel laden…</p>}
            {data && (
                <>
                    <form className="kaart stapel" onSubmit={bewaar}>
                        <p className="kaart-label">Account</p>
                        <p className="dim">@{data.profiel.gebruikersnaam} · {data.profiel.actief ? 'actief' : 'uitgeschakeld'}</p>
                        <label className="kaart-label" htmlFor="profiel-naam">Naam op het hostscherm</label>
                        <input id="profiel-naam" className="invoer" value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={40} required />
                        <button className="knop" type="submit">Opslaan</button>
                        {melding && <p className="dim">{melding}</p>}
                    </form>
                    <div className="overzicht" style={{ marginTop: '1rem' }}>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.spellen}</span><span className="tegel-label">Spellen</span></div>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.punten}</span><span className="tegel-label">Punten</span></div>
                        <div className="tegel"><span className="tegel-waarde">{data.profiel.beste_score}</span><span className="tegel-label">Beste score</span></div>
                    </div>
                    <section className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <p className="kaart-label">Eigen presets ({data.presets.length})</p>
                        {data.presets.length ? <ul className="spelerlijst">{data.presets.map((preset) => <li className="speler-kaart" key={preset.id}><span>{preset.naam}</span><span className="dim">{preset.rondes === 0 ? 'eindeloos' : `${preset.rondes} rondes`}</span></li>)}</ul> : <p className="dim">Nog geen eigen presets.</p>}
                    </section>
                    <section className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <p className="kaart-label">Recente spellen</p>
                        {data.spellen.length ? <ul className="spelerlijst">{data.spellen.map((spel) => <li className="speler-kaart" key={`${spel.code}-${spel.bijgewerkt_op}`}><span>Lobby {spel.code}</span><span className="dim">{spel.spelers} spelers · beste {spel.hoogste_score}</span></li>)}</ul> : <p className="dim">Nog geen afgeronde spellen.</p>}
                    </section>
                </>
            )}
        </main>
    );
}
