import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';

// =====================================================================
// Beheer: ChatGPT koppelen (device-login vanaf de site) + aanbevelingen
// genereren. Mobiel én desktop vriendelijk.
// =====================================================================

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }
async function haal(pad, opties = {}) {
    const r = await fetch(pad, { credentials: 'include', ...opties });
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error((d && d.fout) || 'Er ging iets mis.');
    return d;
}
const jsonBody = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export default function AdminAI() {
    const [ingelogd, setIngelogd] = useState(null); // null = onbekend

    useEffect(() => {
        haal('/api/admin/sessie').then((s) => setIngelogd(!!(s && s.ingelogd)))
            .catch(() => setIngelogd(false));
    }, []);

    if (ingelogd === null) return <main className="scherm"><p className="dim">Laden…</p></main>;
    if (!ingelogd) return <Login onOk={() => setIngelogd(true)} />;
    return <Paneel />;
}

function Login({ onOk }) {
    const [ww, setWw] = useState('');
    const [fout, setFout] = useState('');
    async function login(e) {
        e.preventDefault();
        try { await haal('/api/admin/login', { method: 'POST', ...jsonBody({ wachtwoord: ww }) }); onOk(); }
        catch (err) { setFout(err.message); }
    }
    return (
        <main className="scherm auth-scherm">
            <Brand link={false} />
            <h1>Beheer</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            <form onSubmit={login} className="stapel">
                <input className="invoer" type="password" placeholder="Wachtwoord"
                       value={ww} onChange={(e) => setWw(e.target.value)} autoFocus />
                <button className="knop" type="submit">Inloggen</button>
                <Link className="terug" to="/">← Terug</Link>
            </form>
        </main>
    );
}

function Paneel() {
    return (
        <main className="scherm admin-ai">
            <div className="ai-kop">
                <Brand link compact />
                <Link className="terug" to="/admin">Volledig beheer →</Link>
            </div>
            <h1>Beheer</h1>

            <section className="kaart ai-kaart" style={{ marginBottom: '1rem' }}>
                <p className="kaart-label">Zo vul je de quiz — in 4 stappen</p>
                <ol className="uitleg-stappen">
                    <li><strong>Koppel ChatGPT</strong> (één keer). Dan kan de AI nummers voor je zoeken.</li>
                    <li><strong>Haal nummers op.</strong> Kies een categorie en het gewenste aantal. De AI zoekt bekende herkenningsnummers.</li>
                    <li><strong>Swipe ze.</strong> Eerst blind (ken je het?), daarna de rest mét naam (goed/fout/onbekend). Goedgekeurde nummers komen vanzelf in de quiz.</li>
                    <li><strong>Twijfel je?</strong> Deel de review-link; vrienden luisteren en stemmen.</li>
                </ol>
            </section>

            <div className="ai-grid">
                <ChatGptKoppeling />
                <Genereren />
            </div>
            <Database />
        </main>
    );
}

// ------------------------- Database (simpel) -------------------------

function Database() {
    const [tel, setTel] = useState(null);
    const [bevestig, setBevestig] = useState(false);
    const [bezig, setBezig] = useState(false);
    const [melding, setMelding] = useState('');

    async function ververs() {
        try { setTel(await haal('/api/admin/db-overzicht')); } catch { /* */ }
    }
    useEffect(() => { ververs(); }, []);

    async function schoonBegin() {
        setBezig(true); setMelding('');
        try {
            await haal('/api/admin/database/opschonen', {
                method: 'POST', ...jsonBody({ actie: 'schoon_begin', bevestiging: 'SCHOON' }),
            });
            setMelding('Database is leeg. Haal nu nieuwe AI-aanbevelingen op.');
            setBevestig(false);
            ververs();
        } catch (e) { setMelding(e.message); }
        setBezig(false);
    }

    return (
        <section className="kaart ai-kaart" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">Database</p>
            {!tel ? <p className="dim">Laden…</p> : (
                <div className="ai-tellers" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <Teller label="Titels" n={tel.titels} />
                    <Teller label="Nummers" n={tel.nummers} />
                    <Teller label="Speelbaar" n={tel.speelbaar} />
                    <Teller label="Downloadfouten" n={tel.downloadfouten} />
                </div>
            )}

            {!bevestig ? (
                <button className="knop knop-stil gevaar" style={{ marginTop: '1rem' }}
                        onClick={() => setBevestig(true)}>
                    Schoon beginnen (alles wissen)
                </button>
            ) : (
                <div className="kaart" style={{ marginTop: '1rem', borderColor: 'var(--fout, #e24b4b)' }}>
                    <p style={{ marginTop: 0 }}>
                        Weet je het zeker? Dit wist <strong>alle titels, nummers en aanbevelingen</strong>.
                        Je hostaccount en instellingen blijven staan.
                    </p>
                    <div className="ai-knoprij">
                        <button className="knop gevaar" disabled={bezig} onClick={schoonBegin}>
                            {bezig ? 'Bezig…' : 'Ja, alles wissen'}
                        </button>
                        <button className="knop knop-stil" onClick={() => setBevestig(false)}>Annuleer</button>
                    </div>
                </div>
            )}
            {melding && <p className="feedback neutraal" style={{ marginTop: '0.75rem' }}>{melding}</p>}
        </section>
    );
}

// ----------------------- ChatGPT koppelen -----------------------

function ChatGptKoppeling() {
    const [status, setStatus] = useState(null);
    const [login, setLogin] = useState(null); // {status,url,code,error,regels}
    const poll = useRef(null);

    async function ververs() {
        try { setStatus(await haal('/api/admin/aanbevelingen/status')); } catch { /* */ }
    }
    useEffect(() => { ververs(); return () => clearInterval(poll.current); }, []);

    async function koppel() {
        try {
            const s = await haal('/api/admin/aanbevelingen/login/start', { method: 'POST' });
            setLogin(s);
            clearInterval(poll.current);
            poll.current = setInterval(async () => {
                try {
                    const st = await haal('/api/admin/aanbevelingen/login/status');
                    setLogin(st);
                    if (st.status === 'done' || st.status === 'error') {
                        clearInterval(poll.current);
                        ververs();
                    }
                } catch { /* */ }
            }, 2000);
        } catch (e) { setLogin({ status: 'error', error: e.message }); }
    }

    async function ontkoppel() {
        await haal('/api/admin/aanbevelingen/login/uit', { method: 'POST' }).catch(() => {});
        setLogin(null); ververs();
    }

    const gekoppeld = status && status.chatgpt && status.chatgpt.gekoppeld;

    return (
        <section className="kaart ai-kaart">
            <p className="kaart-label">ChatGPT-koppeling</p>

            <div className="ai-status-rij">
                <span className={'ai-stip ' + (gekoppeld ? 'aan' : 'uit')} />
                <strong>{gekoppeld ? 'Gekoppeld' : 'Niet gekoppeld'}</strong>
            </div>
            <p className="dim ai-uitleg">
                Aanbevelingen draaien via je eigen ChatGPT-account (Codex CLI,
                geen API-key). Je logt één keer in vanaf deze pagina.
            </p>

            {!gekoppeld && (!login || login.status === 'error') && (
                <button className="knop" onClick={koppel}>Koppel ChatGPT</button>
            )}

            {login && login.status !== 'done' && login.status !== 'error' && (
                <div className="ai-login">
                    {login.url && login.code ? (
                        <>
                            <p>1. Open deze link en log in bij ChatGPT:</p>
                            <a className="knop knop-stil ai-link" href={login.url} target="_blank" rel="noreferrer">
                                Open inlogpagina ↗
                            </a>
                            <p style={{ marginTop: '0.75rem' }}>2. Voer deze code in:</p>
                            <div className="ai-code">{login.code}</div>
                            <p className="dim">Daarna bevestig je in ChatGPT. Dit scherm springt vanzelf op “gekoppeld”.</p>
                        </>
                    ) : (
                        <p className="dim">Bezig met starten… een moment.</p>
                    )}
                </div>
            )}

            {login && login.status === 'error' && (
                <p className="waarschuwing" style={{ marginTop: '1rem' }}>{login.error || 'Inloggen mislukt.'}</p>
            )}

            {gekoppeld && (
                <button className="knop knop-stil" onClick={ontkoppel} style={{ marginTop: '0.5rem' }}>
                    Ontkoppelen
                </button>
            )}
        </section>
    );
}

// ------------------------- Aanbevelingen -------------------------

function Genereren() {
    const [bezig, setBezig] = useState(false);
    const [melding, setMelding] = useState('');
    const [aantallen, setAantallen] = useState({});
    const [perCategorie, setPerCategorie] = useState({});
    const [categorie, setCategorie] = useState('film');
    const [aantal, setAantal] = useState(50);
    const categorieen = [['film', 'Films'], ['serie', 'Series'], ['disney', 'Disney'], ['kerst', 'Kerst'], ['rock', 'Rock'], ['80s', '80s'], ['90s', '90s'], ['20s', '20s (2020–2029)'], ['kinder', 'Kinder'], ['100nl', '100% NL']];
    const poll = useRef(null);

    async function ververs() {
        try {
            const s = await haal('/api/admin/aanbevelingen/status');
            setAantallen(s.aantallen || {});
            setPerCategorie(s.perCategorie || {});
            if (s.run && !s.run.bezig) {
                setBezig(false);
                clearInterval(poll.current);
                if (s.run.fout) setMelding(s.run.fout);
                else if (s.run.resultaat) setMelding(`Klaar: ${s.run.resultaat.toegevoegd} toegevoegd.`);
            }
        } catch { /* */ }
    }
    useEffect(() => { ververs(); return () => clearInterval(poll.current); }, []);

    async function start() {
        setBezig(true); setMelding('ChatGPT denkt na… dit kan even duren.');
        try {
            await haal('/api/admin/aanbevelingen/genereer', { method: 'POST', ...jsonBody({ categorie, soort: categorie === 'kerst' ? 'kerst' : 'film_serie', aantal: Number(aantal) }) });
            clearInterval(poll.current);
            poll.current = setInterval(ververs, 3000);
        } catch (e) { setBezig(false); setMelding(e.message); }
    }

    async function herzoek() {
        setMelding('ChatGPT zoekt de juiste nummers opnieuw…');
        try {
            await haal('/api/admin/aanbevelingen/herzoek', { method: 'POST' });
            clearInterval(poll.current);
            poll.current = setInterval(ververs, 3000);
        } catch (e) { setMelding(e.message); }
    }

    const fs = aantallen.film_serie || {};
    const k = aantallen.kerst || {};

    return (
        <section className="kaart ai-kaart">
            <p className="kaart-label">Aanbevelingen ophalen</p>
            <p className="dim ai-uitleg">
                Kies zelf hoeveel nieuwe nummers je per categorie wilt verzamelen. Daarna beoordeel je de fragmenten.
            </p>

            <div className="ai-knoprij" style={{ alignItems: 'end' }}>
                <label style={{ flex: '1 1 160px' }}>Categorie
                    <select className="invoer" value={categorie} onChange={(e) => setCategorie(e.target.value)} style={{ display: 'block', width: '100%' }}>
                        {categorieen.map(([waarde, naam]) => <option key={waarde} value={waarde}>{naam}</option>)}
                    </select>
                </label>
                <label style={{ flex: '1 1 120px' }}>Aantal nummers
                    <input className="invoer" type="number" min="1" max="100" value={aantal}
                        onChange={(e) => setAantal(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </label>
                <button className="knop" disabled={bezig || !Number.isInteger(Number(aantal)) || Number(aantal) < 1 || Number(aantal) > 100} onClick={start}>Lijst maken</button>
            </div>
            <p className="dim">Aantal per aanvraag (1–100). Films en series zijn apart opgeslagen en kunnen later samen worden geselecteerd.</p>
            <div className="ai-tellers" style={{ marginTop: '0.75rem' }}>
                {categorieen.map(([waarde, naam]) =>
                    <Teller key={waarde} label={naam} n={perCategorie[waarde]?.totaal || 0} />)}
            </div>

            {melding && <p className={bezig ? 'dim' : 'feedback neutraal'} style={{ marginTop: '1rem' }}>{melding}</p>}

            <div className="ai-tellers">
                <Teller label="Blind te swipen" n={(fs.nieuw || 0) + (k.nieuw || 0)} />
                <Teller label="Met naam" n={(fs.blind_nee || 0) + (k.blind_nee || 0)} />
                <Teller label="Goedgekeurd" n={(fs.goed || 0) + (k.goed || 0) + (fs.toegevoegd || 0) + (k.toegevoegd || 0)} />
            </div>
            <div className="ai-tellers" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: '0.5rem' }}>
                <Teller label="Fout (AI opnieuw)" n={(fs.fout || 0) + (k.fout || 0)} />
                <Teller label="Bij anderen (review)" n={(fs.review || 0) + (k.review || 0)} />
            </div>

            <div className="ai-knoprij" style={{ marginTop: '1rem' }}>
                {((fs.nieuw || 0) + (k.nieuw || 0) + (fs.blind_nee || 0) + (k.blind_nee || 0)) > 0 && (
                    <Link className="knop" to="/admin/swipe">Swipen →</Link>
                )}
                {((fs.fout || 0) + (k.fout || 0)) > 0 && (
                    <button className="knop knop-stil" onClick={herzoek} disabled={bezig}>
                        Foute opnieuw zoeken
                    </button>
                )}
            </div>

            {((fs.review || 0) + (k.review || 0)) > 0 && <ReviewLink aantal={(fs.review || 0) + (k.review || 0)} />}
        </section>
    );
}

function Teller({ label, n }) {
    return (
        <div className="tegel">
            <span className="tegel-waarde">{n}</span>
            <span className="tegel-label">{label}</span>
        </div>
    );
}

function ReviewLink({ aantal }) {
    const [gekopieerd, setGekopieerd] = useState(false);
    const url = (typeof window !== 'undefined' ? window.location.origin : '') + '/review';
    async function kopieer() {
        try { await navigator.clipboard.writeText(url); setGekopieerd(true); setTimeout(() => setGekopieerd(false), 2000); }
        catch { /* selecteerbaar in beeld */ }
    }
    return (
        <div className="kaart" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">Review-link delen</p>
            <p className="dim ai-uitleg">
                {aantal} nummer{aantal === 1 ? '' : 's'} wacht op anderen. Deel deze link; vrienden
                luisteren blind en stemmen of ze het kennen.
            </p>
            <div className="ai-knoprij">
                <input className="invoer" readOnly value={url} onFocus={(e) => e.target.select()} />
                <button className="knop" onClick={kopieer}>{gekopieerd ? 'Gekopieerd!' : 'Kopieer'}</button>
            </div>
        </div>
    );
}
