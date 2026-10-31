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
            <h1>AI &amp; Aanbevelingen</h1>
            <div className="ai-grid">
                <ChatGptKoppeling />
                <Genereren />
            </div>
        </main>
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
    const poll = useRef(null);

    async function ververs() {
        try {
            const s = await haal('/api/admin/aanbevelingen/status');
            setAantallen(s.aantallen || {});
            if (s.run && !s.run.bezig) {
                setBezig(false);
                clearInterval(poll.current);
                if (s.run.fout) setMelding(s.run.fout);
                else if (s.run.resultaat) setMelding(`Klaar: ${s.run.resultaat.toegevoegd} toegevoegd.`);
            }
        } catch { /* */ }
    }
    useEffect(() => { ververs(); return () => clearInterval(poll.current); }, []);

    async function start(soort) {
        setBezig(true); setMelding('ChatGPT denkt na… dit kan even duren.');
        try {
            await haal('/api/admin/aanbevelingen/genereer', { method: 'POST', ...jsonBody({ soort, aantal: 15 }) });
            clearInterval(poll.current);
            poll.current = setInterval(ververs, 3000);
        } catch (e) { setBezig(false); setMelding(e.message); }
    }

    const fs = aantallen.film_serie || {};
    const k = aantallen.kerst || {};

    return (
        <section className="kaart ai-kaart">
            <p className="kaart-label">Aanbevelingen ophalen</p>
            <p className="dim ai-uitleg">
                ChatGPT draagt bekende films/series met hun herkenningsnummer en
                bekende kerstliedjes aan. Daarna swipe je ze goed of fout.
            </p>

            <div className="ai-knoprij">
                <button className="knop" disabled={bezig} onClick={() => start('film_serie')}>
                    🎬 Films &amp; series
                </button>
                <button className="knop" disabled={bezig} onClick={() => start('kerst')}>
                    🎄 Kerstmuziek
                </button>
            </div>

            {melding && <p className={bezig ? 'dim' : 'feedback neutraal'} style={{ marginTop: '1rem' }}>{melding}</p>}

            <div className="ai-tellers">
                <Teller label="Films/series — te swipen" n={fs.nieuw || 0} />
                <Teller label="Kerst — te swipen" n={k.nieuw || 0} />
                <Teller label="Goedgekeurd" n={(fs.goed || 0) + (k.goed || 0)} />
            </div>

            {((fs.nieuw || 0) + (k.nieuw || 0)) > 0 && (
                <Link className="knop" to="/admin/swipe" style={{ marginTop: '1rem', display: 'inline-flex' }}>
                    Swipen ({(fs.nieuw || 0) + (k.nieuw || 0)}) →
                </Link>
            )}
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
