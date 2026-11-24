import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import ThemaKiezer from '../components/ThemaKiezer.jsx';
import { Bank, Login } from './AdminBank.jsx';
import { leesSessie, wisSessie, bewaarSessie, leesOpgeslagenSpellen, verwijderOpgeslagenSpel } from '../lib/sessie.js';

// Startpagina én beheer in één: zonder ?tab= is het de speelpagina, met
// ?tab=… (alleen voor de beheerder) het beheer met tabs.
export default function Home() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const beheer = params.has('tab');
    const [admin, setAdmin] = useState(null);
    const [code, setCode] = useState('');
    const [vorige, setVorige] = useState(leesSessie);
    const [spellen, setSpellen] = useState(leesOpgeslagenSpellen);
    const [fout, setFout] = useState('');
    const [themaOpen, setThemaOpen] = useState(false);
    const [teksten, setTeksten] = useState({});
    const kop = (k, std) => teksten[k] || std;

    useEffect(() => {
        fetch('/api/admin/sessie', { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}))
            .then((d) => setAdmin(d.ingelogd === true)).catch(() => setAdmin(false));
        fetch('/api/site-teksten').then((r) => (r.ok ? r.json() : {})).then(setTeksten).catch(() => {});
    }, []);

    function meedoen(e) {
        e.preventDefault();
        const schoon = code.trim().toUpperCase();
        if (schoon.length !== 4) { setFout('Een code heeft 4 letters.'); return; }
        navigate(`/join/${schoon}`);
    }

    return (
        <main className={'vt-start' + (beheer ? ' vt-start-beheer' : '')}>
            <TopNav actief={beheer ? 'beheer' : 'home'} teksten={teksten} />
            {admin && (
                <nav className="vt-start-wissel" aria-label="Spelen of beheren">
                    <Link className={!beheer ? 'aan' : ''} to="/">Spelen</Link>
                    <Link className={beheer ? 'aan' : ''} to="/?tab=overzicht">Beheer</Link>
                </nav>
            )}

            {beheer ? (
                admin === null ? <p className="dim">Laden…</p>
                    : admin ? <Bank ingebed />
                        : <Login onOk={() => setAdmin(true)} />
            ) : (
                <div className="vt-start-spelen">
                    <header className="vt-start-kop">
                        <h1>{kop('home.titel', 'Herken jij de muziek?')}</h1>
                        <p>{kop('home.ondertitel', 'Films, series, games en hits. Speel samen op je telefoon.')}</p>
                    </header>

                    <button type="button" className="vt-start-nieuw" onClick={() => navigate('/host/login?return=/setup/new')}>
                        <strong>{kop('home.nieuw_spel', 'Nieuw spel')}</strong>
                        <span>Kies wat je wilt horen en nodig iedereen uit</span>
                    </button>

                    <form className="vt-start-mee" onSubmit={meedoen}>
                        <label htmlFor="vt-code">{kop('home.meedoen', 'Meedoen met code')}</label>
                        <div>
                            <input id="vt-code" className="invoer" value={code} maxLength={4} placeholder="ABCD"
                                autoCapitalize="characters" autoComplete="off" onChange={(e) => { setCode(e.target.value.toUpperCase()); setFout(''); }} />
                            <button className="knop" type="submit">Doe mee</button>
                        </div>
                        {fout && <small className="vt-start-fout">{fout}</small>}
                    </form>

                    {spellen.length > 0 && (
                        <div className="vt-start-verder">
                            <span className="kz-label">Verder spelen</span>
                            <div>
                                {spellen.slice(0, 3).map((s) => (
                                    <span key={s.code} className="vt-start-spel">
                                        <button type="button" onClick={() => { bewaarSessie(s); navigate(s.is_host ? '/host' : '/play'); }}>
                                            {s.code} <small>{s.is_host ? 'host' : 'speler'}</small>
                                        </button>
                                        <button type="button" aria-label={'Vergeet ' + s.code} onClick={() => {
                                            verwijderOpgeslagenSpel(s.code);
                                            setSpellen(leesOpgeslagenSpellen());
                                            if (vorige?.code === s.code) { wisSessie(); setVorige(null); }
                                        }}>×</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <footer className="vt-start-voet">
                        <Link to="/aanvragen">Iets missen? Voeg toe</Link>
                        <button type="button" onClick={() => setThemaOpen((o) => !o)} aria-expanded={themaOpen}>Thema</button>
                        <Link to="/changelog">Wat is nieuw</Link>
                    </footer>
                    {themaOpen && <div className="vt-start-themas"><ThemaKiezer /></div>}
                </div>
            )}
        </main>
    );
}
