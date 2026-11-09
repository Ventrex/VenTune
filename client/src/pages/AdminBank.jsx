import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import Admin from './Admin.jsx';
import Hint from '../components/Hint.jsx';
import './admin-bank.css';

// =====================================================================
// Beheer 2.0 — de vragenbank in één scherm met tabs per controle.
// De AI-curator bepaalt en keurt alles; hier zie je wat hij doet en pas
// je zelf iets aan. Een aangepast veld krijgt een slotje: de AI blijft er
// dan af. Klik op het slotje om het weer aan de AI over te laten.
// =====================================================================

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }
async function api(pad, opties = {}) {
    const init = { credentials: 'include', ...opties };
    if (opties.body && typeof opties.body !== 'string') {
        init.body = JSON.stringify(opties.body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const r = await fetch(pad, init);
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error((d && d.fout) || 'Er ging iets mis.');
    return d;
}

// Hoofdtabs met daaronder subtabs. Controles = alles bekijken en bewerken,
// Fixes = alleen wat aandacht nodig heeft.
// Alles van beheer staat hier: één pagina, één rij tabs met subtabs.
const GROEPEN = [['overzicht', 'Overzicht'], ['swipen', 'Swipen'], ['collecties', 'Collecties'], ['controles', 'Controles'],
    ['fixes', 'Fixes'], ['spelers', 'Spelers'], ['log', 'Logs'], ['systeem', 'Systeem']];
const SPELERS = [['meldingen', 'Meldingen'], ['vragen', 'Vraagsuggesties'], ['controle', 'Verdachte spellen'], ['users', 'Accounts']];
const LOGS = [['ai', 'AI-log'], ['logs', 'Gebeurtenissen']];
const SYSTEEM = [['database', 'Database'], ['uiterlijk', 'Uiterlijk'], ['teksten', 'Teksten']];
const CONTROLES = [
    ['nummers', 'Nummers'], ['mp3', 'MP3'], ['hints', 'Hints'], ['vragen', 'Vragen'],
    ['jaartal', 'Jaartal'], ['nl', 'NL-check'], ['antwoorden', 'Antwoorden'],
];
// [id, label, lijst, filter, teller uit voorraad]
const FIXES = [
    ['mp3-mist', 'MP3 ontbreekt', 'mp3', 'mist', 'zonder_mp3'],
    ['mp3-opgegeven', 'MP3 opgegeven', 'mp3', 'opgegeven', 'mp3_opgegeven'],
    ['hints-leeg', 'Hints onvolledig', 'hints', 'leeg', 'zonder_hints'],
    ['vragen-leeg', 'Vragen onvolledig', 'vragen', 'leeg', 'zonder_vragen'],
    ['nl-twijfel', 'NL: twijfel', 'nl', 'twijfel', 'nl_twijfel'],
    ['nog-bij-ai', 'Nog bij AI', 'nummers', 'te_beoordelen', 'te_beoordelen'],
    ['uitgesloten', 'Uitgesloten', 'nummers', 'uitgesloten', 'uitgesloten'],
    ['dubbelen', 'Dubbelen', null, null, null],
];
const CATS = [['film', 'Films'], ['serie', 'Series'], ['anime', 'Anime'], ['game', 'Videogames'], ['muziek', 'Muziek'], ['kerst', 'Kerst'], ['kinder', 'Kinder']];
const CAT_LABEL = Object.fromEntries(CATS);
const TIERS = [['iconisch', 'Iconisch'], ['algemeen_bekend', 'Algemeen bekend'], ['bekend', 'Bekend'], ['onbekend', 'Onbekend'], ['cult', 'Cult']];
const TIER_LABEL = Object.fromEntries(TIERS);
const FILTER_LABEL = {
    alle: 'Alles', aanvragen: 'Aanvragen', te_beoordelen: 'Nog bij AI', handmatig: 'Zelf aangepast', uitgesloten: 'Uitgesloten',
    mist: 'Mist', opgegeven: 'Opgegeven', aanwezig: 'Aanwezig', leeg: 'Onvolledig',
    nee: 'Niet bekend', twijfel: 'Twijfel', ja: 'Bekend', zonder_franchise: 'Zonder franchise', anime: 'Anime',
};
/** Jaar zoals spelers het zien: 1994, of bij series 2005–2013 / 2025–. */
function jaarTekst(item) {
    if (!item?.jaar) return '';
    if (item.serie_lopend) return `${item.jaar}–`;
    if (item.eind_jaar && item.eind_jaar !== item.jaar) return `${item.jaar}–${item.eind_jaar}`;
    return String(item.jaar);
}

const STAP_LABEL = {
    opstarten: 'Opstarten', beoordelen: 'Beoordelen', mp3: 'MP3 zoeken', quiz: 'Hints & vragen',
    aanvullen: 'Aanvullen', collecties: 'Collecties', verbeteren: 'Verbeterpunten', pauze: 'Even pauze', klaar: 'Alles bijgewerkt',
    wacht: 'Wacht', uit: 'Uit', fout: 'Fout',
};

export default function AdminBank() {
    const [ingelogd, setIngelogd] = useState(null);
    useEffect(() => {
        api('/api/admin/sessie').then((s) => setIngelogd(!!s?.ingelogd)).catch(() => setIngelogd(false));
    }, []);
    if (ingelogd === null) return <main className="scherm"><p className="dim">Laden…</p></main>;
    if (!ingelogd) return <Login onOk={() => setIngelogd(true)} />;
    return <Bank />;
}

function Login({ onOk }) {
    const [ww, setWw] = useState('');
    const [fout, setFout] = useState('');
    async function login(e) {
        e.preventDefault();
        try { await api('/api/admin/login', { method: 'POST', body: { wachtwoord: ww } }); onOk(); }
        catch (err) { setFout(err.message); }
    }
    return (
        <main className="scherm auth-scherm">
            <Brand link={false} />
            <h1>Beheer</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            <form onSubmit={login} className="stapel">
                <input className="invoer" type="password" placeholder="Wachtwoord" value={ww}
                    onChange={(e) => setWw(e.target.value)} autoFocus />
                <button className="knop" type="submit">Inloggen</button>
            </form>
        </main>
    );
}

function Bank() {
    const [params, setParams] = useSearchParams();
    const tab = GROEPEN.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overzicht';
    const sub = params.get('sub') || '';
    const [status, setStatus] = useState(null);
    const [fout, setFout] = useState('');

    const laadStatus = useCallback(() => {
        api('/api/admin/bank/status').then((s) => { setStatus(s); setFout(''); }).catch((e) => setFout(e.message));
    }, []);
    useEffect(() => {
        laadStatus();
        const t = setInterval(laadStatus, 8000);
        return () => clearInterval(t);
    }, [laadStatus]);

    const ga = (nieuweTab, extra = {}) => setParams({ tab: nieuweTab, ...extra });
    // Op een telefoon de actieve tabs in beeld schuiven.
    useEffect(() => {
        document.querySelectorAll('.ab-tab.actief, .ab-subtab.actief')
            .forEach((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }, [tab, sub]);

    const controle = CONTROLES.some(([id]) => id === sub) ? sub : CONTROLES[0][0];
    const kies = (lijst) => (lijst.some(([id]) => id === sub) ? sub : lijst[0][0]);
    const spelerSub = kies(SPELERS);
    const logSub = kies(LOGS);
    const systeemSub = kies(SYSTEEM);
    async function uitloggen() {
        await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        window.location.reload();
    }
    const fix = FIXES.find(([id]) => id === sub) || FIXES[0];
    const v = status?.voorraad || {};

    return (
        <main className="ab">
            <header className="ab-kop">
                <Brand link compact />
                <h1>Beheer</h1>
                <button type="button" className="ab-linkknop ab-uitlog" onClick={uitloggen}>Uitloggen</button>
            </header>
            {fout && <p className="waarschuwing">{fout}</p>}
            <WorkerBalk status={status} onWijzig={laadStatus} />
            <nav className="ab-tabs" aria-label="Onderdelen">
                {GROEPEN.map(([id, naam]) => (
                    <button key={id} type="button" className={'ab-tab' + (tab === id ? ' actief' : '')}
                        onClick={() => ga(id)}>{naam}{tabTeller(id, status)}</button>
                ))}
            </nav>
            {tab === 'swipen' && (
                <SubTabs actief={sub} onKies={(id) => ga('swipen', id ? { sub: id } : {})}
                    items={[['', 'Alles'], ...CATS]} teller={(id) => (id ? status?.swipe?.[id] : v.te_swipen)} />
            )}
            {tab === 'controles' && (
                <SubTabs actief={controle} onKies={(id) => ga('controles', { sub: id })} items={CONTROLES} />
            )}
            {tab === 'fixes' && (
                <SubTabs actief={fix[0]} onKies={(id) => ga('fixes', { sub: id })}
                    items={FIXES.map(([id, naam]) => [id, naam])}
                    teller={(id) => v[FIXES.find((f) => f[0] === id)?.[4]]} />
            )}

            {tab === 'overzicht' && <Overzicht status={status} onWijzig={laadStatus} ga={ga} />}
            {tab === 'swipen' && <Swipen key={sub} categorie={sub} onWijzig={laadStatus} />}
            {tab === 'controles' && <Lijst key={`c-${controle}`} tab={controle} standaardFilter="alle" />}
            {tab === 'fixes' && fix[0] === 'dubbelen' && <Dubbelen />}
            {tab === 'fixes' && fix[0] !== 'dubbelen' && <Lijst key={`f-${fix[0]}`} tab={fix[2]} standaardFilter={fix[3]} vasteFilter />}
            {tab === 'collecties' && <Collecties key={sub} gekozen={sub} onKies={(id) => ga('collecties', id ? { sub: String(id) } : {})} />}
            {tab === 'spelers' && <SubTabs actief={spelerSub} onKies={(id) => ga('spelers', { sub: id })} items={SPELERS} />}
            {tab === 'log' && <SubTabs actief={logSub} onKies={(id) => ga('log', { sub: id })} items={LOGS} />}
            {tab === 'systeem' && <SubTabs actief={systeemSub} onKies={(id) => ga('systeem', { sub: id })} items={SYSTEEM} />}
            {tab === 'log' && logSub === 'ai' && <Log />}
            {tab === 'log' && logSub !== 'ai' && <Admin ingebed sectie={logSub} />}
            {tab === 'spelers' && <Admin ingebed sectie={spelerSub} />}
            {tab === 'systeem' && <Admin ingebed sectie={systeemSub} />}
        </main>
    );
}

function SubTabs({ items, actief, onKies, teller }) {
    return (
        <nav className="ab-subtabs" aria-label="Subonderdelen">
            {items.map(([id, naam]) => {
                const n = teller ? teller(id) : null;
                return (
                    <button key={id || 'alles'} type="button" className={'ab-subtab' + (actief === id ? ' actief' : '')}
                        onClick={() => onKies(id)}>
                        {naam}{n ? <span className="ab-teller">{n > 999 ? '999+' : n}</span> : null}
                    </button>
                );
            })}
        </nav>
    );
}

function tabTeller(id, status) {
    const v = status?.voorraad;
    if (!v) return null;
    const n = { swipen: v.te_swipen, fixes: (v.mp3_opgegeven || 0) + (v.nl_twijfel || 0) }[id];
    return n ? <span className="ab-teller">{n > 999 ? '999+' : n}</span> : null;
}

// ------------------------------------------------------------------
// Swipen: de MP3's die de AI vond goed- of afkeuren
// ------------------------------------------------------------------

const DREMPEL = 110; // zo ver slepen = beslissen

function Swipen({ categorie, onWijzig }) {
    const [rij, setRij] = useState([]);
    const [klaar, setKlaar] = useState(false);
    const [melding, setMelding] = useState('');
    const behandeld = useRef(new Set());
    const laden = useRef(false);

    const laad = useCallback(async () => {
        if (laden.current) return;
        laden.current = true;
        try {
            const q = new URLSearchParams({ categorie, overslaan: [...behandeld.current].slice(-300).join(',') });
            const d = await api(`/api/admin/bank/swipe?${q}`);
            setRij((oud) => {
                const al = new Set(oud.map((i) => i.track_id));
                const nieuw = d.items.filter((i) => !behandeld.current.has(i.track_id) && !al.has(i.track_id));
                return [...oud, ...nieuw];
            });
            setKlaar(d.items.length === 0);
        } catch (e) { setMelding(e.message); }
        finally { laden.current = false; }
    }, [categorie]);
    useEffect(() => { laad(); }, [laad]);
    useEffect(() => { if (rij.length < 4 && !klaar) laad(); }, [rij.length, klaar, laad]);

    const huidig = rij[0];
    const volgende = rij[1];

    // Direct door naar het volgende nummer; de server krijgt het op de achtergrond.
    const beslis = useCallback((keuze) => {
        if (!huidig) return;
        behandeld.current.add(huidig.track_id);
        setRij((r) => r.filter((i) => i.track_id !== huidig.track_id));
        if (keuze === 'later') return;
        const item = huidig;
        api(`/api/admin/bank/swipe/${item.track_id}`, { method: 'POST', body: { keuze } })
            .then(() => onWijzig())
            .catch((e) => {
                // Niet opgeslagen: het nummer komt vooraan terug, zodat je opnieuw kunt kiezen.
                behandeld.current.delete(item.track_id);
                setRij((r) => (r.some((i) => i.track_id === item.track_id) ? r : [item, ...r]));
                setMelding(`${item.naam} niet opgeslagen (${e.message}); kies opnieuw.`);
            });
    }, [huidig, onWijzig]);

    useEffect(() => {
        const toets = (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (e.key === 'ArrowRight') beslis('goed');
            else if (e.key === 'ArrowLeft') beslis('fout');
            else if (e.key === 'ArrowDown') beslis('later');
        };
        window.addEventListener('keydown', toets);
        return () => window.removeEventListener('keydown', toets);
    }, [beslis]);

    // Volgende MP3 alvast laden, zodat die meteen speelt.
    useEffect(() => {
        if (!volgende?.mp3_url) return;
        const a = new Audio();
        a.preload = 'auto';
        a.src = volgende.mp3_url;
    }, [volgende?.mp3_url]);

    if (!huidig) {
        return (
            <div className="ab-kaart ab-swipe-leeg">
                {melding && <p className="ab-rood">{melding}</p>}
                <p><strong>{klaar ? 'Niets meer te swipen 🎉' : 'Laden…'}</strong>{klaar && <Hint tekst="De AI zoekt op de achtergrond verder; nieuwe nummers verschijnen hier vanzelf. Iconisch komt altijd eerst." />}</p>
                {klaar && <button type="button" className="ab-knop" onClick={() => { setKlaar(false); laad(); }}>Opnieuw kijken</button>}
            </div>
        );
    }
    return (
        <div className="ab-swipe">
            {melding && <p className="ab-rood ab-mini">{melding}</p>}
            <SwipeKaart key={huidig.track_id} item={huidig} onBeslis={beslis} />
            <p className="dim ab-mini ab-swipe-uitleg">Sleep naar rechts = goed, naar links = fout. Toetsen: → goed, ← fout, ↓ later.</p>
        </div>
    );
}

function SwipeKaart({ item, onBeslis }) {
    const [dx, setDx] = useState(0);
    const [weg, setWeg] = useState(0);
    const start = useRef(null);

    function down(e) {
        if (e.target.closest('.ab-speler, button, a, input')) return;
        start.current = { x: e.clientX, id: e.pointerId };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function move(e) {
        if (!start.current || start.current.id !== e.pointerId) return;
        setDx(e.clientX - start.current.x);
    }
    function up() {
        if (!start.current) return;
        start.current = null;
        if (Math.abs(dx) >= DREMPEL) beslisMet(dx > 0 ? 'goed' : 'fout');
        else setDx(0);
    }
    function beslisMet(keuze) {
        setWeg(keuze === 'goed' ? 1 : keuze === 'fout' ? -1 : 0);
        setTimeout(() => onBeslis(keuze), 160);
    }

    const ver = Math.min(1, Math.abs(dx) / DREMPEL);
    const richting = dx > 0 ? 'goed' : 'fout';
    const transform = weg
        ? `translateX(${weg * 120}%) rotate(${weg * 18}deg)`
        : `translateX(${dx}px) rotate(${dx / 18}deg)`;
    return (
        <div className="ab-swipe-wrap">
            {/* Balk die volloopt naarmate je verder sleept */}
            <div className="ab-swipe-meter" aria-hidden="true">
                <span className="fout" style={{ width: dx < 0 ? `${ver * 50}%` : 0 }} />
                <span className="goed" style={{ width: dx > 0 ? `${ver * 50}%` : 0 }} />
                <em className={ver >= 1 ? 'vol' : ''}>
                    {Math.abs(dx) > 10
                        ? (ver >= 1 ? `Loslaten = ${richting.toUpperCase()}` : `Verder slepen voor ${richting}…`)
                        : '← fout · sleep de kaart · goed →'}
                </em>
            </div>
            <article className={'ab-swipe-kaart' + (start.current ? ' slepen' : '')}
                style={{ transform, transition: start.current ? 'none' : 'transform 0.18s ease' }}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <span className="ab-stempel goed" style={{ opacity: dx > 0 ? ver : 0 }}>GOED ✓</span>
                <span className="ab-stempel fout" style={{ opacity: dx < 0 ? ver : 0 }}>FOUT ✕</span>
                <div className="ab-badges">
                    <span className={`ab-badge cat-${item.categorie}`}>{CAT_LABEL[item.categorie] || item.categorie}</span>
                    {item.bekendheid_tier && <span className={`ab-badge tier-${item.bekendheid_tier}`}>{TIER_LABEL[item.bekendheid_tier]}</span>}
                    {item.jaar && <span className="ab-badge">{jaarTekst(item)}</span>}
                </div>
                <h2 className="ab-swipe-titel">{item.naam}</h2>
                <p className="ab-swipe-nummer">♪ {[item.nummer_naam, item.nummer_artiest].filter(Boolean).join(' – ') || 'Herkenningsnummer'}</p>
                <Speler src={item.mp3_url} />
                <p className="dim ab-mini">YouTube: {item.youtube_titel || '—'}</p>
                {item.verificatie_reden && <p className="dim ab-mini">{item.verificatie_reden}</p>}
            </article>
            <div className="ab-swipe-knoppen">
                <button type="button" className="ab-groot fout" onClick={() => beslisMet('fout')}>✕<span>Fout</span></button>
                <button type="button" className="ab-groot later" onClick={() => onBeslis('later')}>↓<span>Later</span></button>
                <button type="button" className="ab-groot goed" onClick={() => beslisMet('goed')}>✓<span>Goed</span></button>
            </div>
            <button type="button" className="ab-linkknop ab-mini dim" onClick={() => {
                if (window.confirm(`${item.naam} helemaal uit het spel halen?`)) onBeslis('uitsluiten');
            }}>Titel hoort niet in het spel</button>
        </div>
    );
}

/** Speler met grote knoppen en een brede schuifbalk (ook op mobiel). */
function Speler({ src }) {
    const audio = useRef(null);
    const [speelt, setSpeelt] = useState(false);
    const [tijd, setTijd] = useState(0);
    const [duur, setDuur] = useState(0);
    useEffect(() => {
        const a = audio.current;
        if (!a) return;
        setTijd(0); setDuur(0);
        a.load();
        a.play().catch(() => setSpeelt(false));
    }, [src]);
    const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
    const spring = (d) => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min((a.duration || 0) - 0.5, a.currentTime + d)); };
    return (
        <div className="ab-speler">
            <audio ref={audio} src={src} preload="auto"
                onPlay={() => setSpeelt(true)} onPause={() => setSpeelt(false)} onEnded={() => setSpeelt(false)}
                onTimeUpdate={(e) => setTijd(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuur(e.currentTarget.duration)} />
            <div className="ab-speler-knoppen">
                <button type="button" className="ab-knop" onClick={() => spring(-10)}>−10s</button>
                <button type="button" className="ab-speel" onClick={() => (speelt ? audio.current.pause() : audio.current.play())}>
                    {speelt ? '❚❚' : '▶'}
                </button>
                <button type="button" className="ab-knop" onClick={() => spring(10)}>+10s</button>
            </div>
            <input className="ab-schuif" type="range" min="0" max={duur || 0} step="0.1" value={Math.min(tijd, duur || 0)}
                onChange={(e) => { audio.current.currentTime = Number(e.target.value); setTijd(Number(e.target.value)); }} />
            <div className="ab-speler-tijd dim ab-mini"><span>{fmt(tijd)}</span><span>{fmt(duur)}</span></div>
        </div>
    );
}

// ------------------------------------------------------------------
// ChatGPT koppelen (eenmalig, via de Codex-login van de server)
// ------------------------------------------------------------------

function ChatGptKoppeling({ onWijzig }) {
    const [login, setLogin] = useState(null);
    const poll = useRef(null);
    useEffect(() => () => clearInterval(poll.current), []);
    async function koppel() {
        try {
            setLogin(await api('/api/admin/aanbevelingen/login/start', { method: 'POST' }));
            clearInterval(poll.current);
            poll.current = setInterval(async () => {
                try {
                    const st = await api('/api/admin/aanbevelingen/login/status');
                    setLogin(st);
                    if (st.status === 'done' || st.status === 'error') { clearInterval(poll.current); onWijzig?.(); }
                } catch { /* opnieuw bij de volgende poll */ }
            }, 2000);
        } catch (e) { setLogin({ status: 'error', error: e.message }); }
    }
    if (login && login.status !== 'error' && login.status !== 'done') {
        return login.url && login.code ? (
            <div className="ab-stapel">
                <p>1. Open de inlogpagina en log in bij ChatGPT:</p>
                <a className="ab-knop" href={login.url} target="_blank" rel="noreferrer">Open inlogpagina ↗</a>
                <p>2. Voer deze code in:</p>
                <p className="ab-code">{login.code}</p>
                <p className="dim ab-mini">Dit scherm springt vanzelf op gekoppeld.</p>
            </div>
        ) : <p className="dim">Bezig met starten…</p>;
    }
    return (
        <div className="ab-stapel">
            {login?.status === 'error' && <p className="ab-rood">{login.error || 'Inloggen mislukt.'}</p>}
            {login?.status === 'done' ? <p>Gekoppeld ✓</p>
                : <button type="button" className="ab-knop" onClick={koppel}>Koppel ChatGPT</button>}
        </div>
    );
}

// ------------------------------------------------------------------
// Statusbalk van de AI-curator
// ------------------------------------------------------------------

function WorkerBalk({ status, onWijzig }) {
    if (!status) return <div className="ab-balk"><span className="dim">Status laden…</span></div>;
    const w = status.worker;
    const aan = status.instellingen.aan;
    const bezig = !['uit', 'wacht', 'fout', 'klaar'].includes(w.stap);
    const pauzeTot = Math.max(w.pauzeTot || 0, status.instellingen.pauzeTot ? new Date(status.instellingen.pauzeTot).getTime() : 0);
    const max = status.instellingen.maxPerDag;
    async function zet(nieuw) {
        await api('/api/admin/bank/worker', { method: 'POST', body: { aan: nieuw } }).catch(() => {});
        onWijzig();
    }
    return (
        <section className={'ab-balk' + (aan ? '' : ' uit')}>
            <span className={'ab-stip ' + (!aan ? 'uit' : w.stap === 'fout' || w.stap === 'wacht' ? 'let-op' : bezig ? 'bezig' : 'ok')} />
            <div className="ab-balk-tekst">
                <strong>AI-curator: {aan ? (STAP_LABEL[w.stap] || w.stap) : 'uit'}
                    {aan && w.inhaalslag && <span className="ab-badge tier-iconisch" style={{ marginLeft: 6 }}>Inhaalslag: hele database indelen</span>}</strong>
                <span className="dim">{w.bericht}</span>
                {w.laatsteActie && <span className="dim">Laatst: {w.laatsteActie}</span>}
                {w.laatsteFout && <span className="ab-rood">Fout: {w.laatsteFout}</span>}
                {pauzeTot > Date.now() && (
                    <span className="ab-rood">Gepauzeerd tot {new Date(pauzeTot).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{' '}
                        <button type="button" className="ab-linkknop" onClick={async () => { await api('/api/admin/bank/hervat', { method: 'POST' }).catch(() => {}); onWijzig(); }}>Nu verder</button>
                    </span>
                )}
            </div>
            <div className="ab-balk-cijfers dim">
                Vandaag {w.vandaag ?? 0}{max ? `/${max}` : ''} AI-vragen
                <Hint tekst={`Sinds de herstart: ${w.tellers.beoordeeld} beoordeeld, ${w.tellers.mp3} MP3, ${w.tellers.quiz} quiz, ${w.tellers.toegevoegd} nieuw, ${w.tellers.verbeterd} verbeterd.`} />
            </div>
            <button type="button" className="ab-knop" onClick={() => zet(!aan)}>{aan ? 'Pauzeren' : 'Aanzetten'}</button>
        </section>
    );
}

// ------------------------------------------------------------------
// Overzicht
// ------------------------------------------------------------------

function Overzicht({ status, onWijzig, ga }) {
    if (!status) return null;
    const { tellingen, instellingen, voorraad, chatgpt } = status;
    async function verhoog(cat, erbij) {
        await api(`/api/admin/bank/doel/${cat}`, { method: 'POST', body: { erbij } }).catch((e) => alert(e.message));
        onWijzig();
    }
    async function wisselVoorrang(cat) {
        const nu = instellingen.voorrang || [];
        const voorrang = nu.includes(cat) ? nu.filter((c) => c !== cat) : [...nu, cat];
        await api('/api/admin/bank/instellingen', { method: 'PATCH', body: { voorrang } }).catch((e) => alert(e.message));
        onWijzig();
    }
    async function zetDoel(cat, waarde) {
        await api('/api/admin/bank/instellingen', { method: 'PATCH', body: { doelen: { [cat]: Number(waarde) } } }).catch((e) => alert(e.message));
        onWijzig();
    }
    const tegels = [
        ['Te swipen', voorraad.te_swipen, 'swipen', {}],
        ['Nog door AI te beoordelen', voorraad.te_beoordelen, 'fixes', { sub: 'nog-bij-ai' }],
        ['Zonder MP3', voorraad.zonder_mp3, 'fixes', { sub: 'mp3-mist' }],
        ['MP3 opgegeven (jij kijken)', voorraad.mp3_opgegeven, 'fixes', { sub: 'mp3-opgegeven' }],
        ['Zonder 3 hints', voorraad.zonder_hints, 'fixes', { sub: 'hints-leeg' }],
        ['Zonder bonusvragen', voorraad.zonder_vragen, 'fixes', { sub: 'vragen-leeg' }],
        ['NL: twijfel', voorraad.nl_twijfel, 'fixes', { sub: 'nl-twijfel' }],
        ['Uitgesloten', voorraad.uitgesloten, 'fixes', { sub: 'uitgesloten' }],
    ];
    async function allesOpnieuw() {
        if (!window.confirm('Alles opnieuw? De AI beoordeelt alle titels opnieuw, zoekt alle ontbrekende MP3\'s (ook opgegeven) opnieuw en maakt ontbrekende hints en vragen. Wat je zelf hebt aangepast blijft staan.')) return;
        try { const r = await api('/api/admin/bank/alles-opnieuw', { method: 'POST' }); alert(r.tekst); }
        catch (e) { alert(e.message); }
        onWijzig();
    }
    const voorrang = instellingen.voorrang || [];
    return (
        <div className="ab-stapel">
            <section className="ab-kaart ab-acties-blok">
                <div className="ab-rij">
                    <button type="button" className="ab-knop ab-groot-knop" onClick={allesOpnieuw}>▶ Alles starten &amp; opnieuw zoeken</button>
                </div>
                <p className="ab-label" style={{ marginTop: '0.8rem' }}>Voorrang <Hint tekst="Een categorie met ★ gaat bij alles voor: eerst indelen (iconisch t/m cult), MP3's zoeken, hints maken en aanvullen, daarna de rest. Een thema (bv. Sinterklaas) geef je voorrang bij Collecties." /></p>
                <div className="ab-chips">
                    {CATS.map(([id, naam]) => (
                        <button key={id} type="button" className={'ab-chip' + (voorrang.includes(id) ? ' actief' : '')}
                            onClick={() => wisselVoorrang(id)}>{voorrang.includes(id) ? '★ ' : ''}{naam}</button>
                    ))}
                </div>
            </section>
            {!chatgpt.gekoppeld && (
                <section className="ab-kaart">
                    <p className="ab-label">ChatGPT koppelen</p>
                    <p><Hint soort="!" tekst="Zonder koppeling kan de AI-curator niets doen. Eén keer koppelen is genoeg." /></p>
                    <ChatGptKoppeling onWijzig={onWijzig} />
                </section>
            )}
            <section className="ab-kaart">
                <p className="ab-label">Per categorie en bekendheid <Hint tekst="Onder het doel vult de AI aan met titels die in Nederland bekend zijn: eerst iconisch, dan algemeen bekend, bekend, onbekend en cult. Speelbaar = MP3 die jij bij Swipen hebt goedgekeurd." /></p>
                <div className="ab-scroll">
                    <table className="ab-matrix">
                        <thead><tr>
                            <th>Categorie</th>{TIERS.map(([id, n]) => <th key={id}>{n}</th>)}<th>Nog niet</th>
                            <th>Totaal</th><th>Speelbaar</th><th>Doel</th><th>Erbij</th><th>Voorrang</th>
                        </tr></thead>
                        <tbody>{CATS.map(([cat, naam]) => {
                            const t = tellingen[cat] || { totaal: 0, speelbaar: 0, tiers: {} };
                            const doel = instellingen.doelen[cat] || 0;
                            return (
                                <tr key={cat}>
                                    <th><button type="button" className="ab-linkknop" onClick={() => ga('controles', { sub: 'nummers', categorie: cat })}>{naam}</button></th>
                                    {TIERS.map(([id]) => (
                                        <td key={id}>
                                            <button type="button" className="ab-linkknop" onClick={() => ga('controles', { sub: 'nummers', categorie: cat, tier: id })}>
                                                {t.tiers[id]?.totaal || 0}
                                            </button>
                                        </td>
                                    ))}
                                    <td className="dim">{t.tiers.nog_niet?.totaal || 0}</td>
                                    <td><strong>{t.totaal}</strong></td>
                                    <td>{t.speelbaar}</td>
                                    <td><DoelVeld waarde={doel} onSave={(w) => zetDoel(cat, w)} />{t.totaal < doel && <span className="ab-mini dim"> nog {doel - t.totaal}</span>}</td>
                                    <td className="ab-nowrap">
                                        <button type="button" className="ab-knop klein" onClick={() => verhoog(cat, 100)}>+100</button>
                                        <button type="button" className="ab-knop klein" onClick={() => verhoog(cat, 500)}>+500</button>
                                    </td>
                                    <td>
                                        <button type="button" className={'ab-knop klein' + ((instellingen.voorrang || []).includes(cat) ? ' ab-aan' : '')}
                                            title="Deze categorie gaat bij alles voor (lijsten, MP3's, hints, swipen)"
                                            onClick={() => wisselVoorrang(cat)}>{(instellingen.voorrang || []).includes(cat) ? '★ Eerst' : '☆'}</button>
                                    </td>
                                </tr>
                            );
                        })}</tbody>
                    </table>
                </div>
            </section>
            <section className="ab-tegels">
                {tegels.map(([naam, n, t, extra]) => (
                    <button key={naam} type="button" className="ab-tegel" onClick={() => ga(t, extra)}>
                        <strong>{n ?? 0}</strong><span>{naam}</span>
                    </button>
                ))}
            </section>
            <Tempo instellingen={instellingen} vandaag={status.worker?.vandaag ?? 0} onWijzig={onWijzig} />
        </div>
    );
}

// Tempo: hoe hard de AI het ChatGPT-abonnement gebruikt.
const TEMPOS = [
    ['zuinig', 'Zuinig', { maxPerDag: 40, pauzeSeconden: 180, webZoeken: 'belangrijk' }],
    ['normaal', 'Normaal', { maxPerDag: 120, pauzeSeconden: 60, webZoeken: 'belangrijk' }],
    ['snel', 'Snel', { maxPerDag: 0, pauzeSeconden: 30, webZoeken: 'altijd' }],
];
function Tempo({ instellingen, vandaag, onWijzig }) {
    const [tot, setTot] = useState('');
    const huidig = TEMPOS.find(([, , v]) => v.maxPerDag === instellingen.maxPerDag && v.pauzeSeconden === instellingen.pauzeSeconden && v.webZoeken === instellingen.webZoeken)?.[0];
    const patch = async (body) => { await api('/api/admin/bank/instellingen', { method: 'PATCH', body }).catch((e) => alert(e.message)); onWijzig(); };
    const pauzeTot = instellingen.pauzeTot ? new Date(instellingen.pauzeTot) : null;
    return (
        <section className="ab-kaart">
            <p className="ab-label">Tempo <Hint tekst="Hoe zuiniger, hoe minder je ChatGPT-limiet opgaat. Het indelen, hints en vragen duren dan langer, maar lopen gewoon door. Webzoeken kost het meest; bij Zuinig en Normaal gebruikt de AI het alleen bij het beoordelen." /></p>
            <div className="ab-chips">
                {TEMPOS.map(([id, naam, v]) => (
                    <button key={id} type="button" className={'ab-chip' + (huidig === id ? ' actief' : '')} onClick={() => patch(v)}>{naam}</button>
                ))}
            </div>
            <div className="ab-velden">
                <Tekst label="AI-vragen per dag (0 = onbeperkt)" type="number" waarde={instellingen.maxPerDag} onSave={(v) => patch({ maxPerDag: Number(v) })} />
                <Tekst label="Seconden tussen stappen" type="number" waarde={instellingen.pauzeSeconden} onSave={(v) => patch({ pauzeSeconden: Number(v) })} />
                <Keuze label="Webzoeken" waarde={instellingen.webZoeken} opties={[['belangrijk', 'Alleen bij beoordelen'], ['altijd', 'Altijd'], ['nooit', 'Nooit']]} onSave={(v) => patch({ webZoeken: v })} />
            </div>
            <p className="dim ab-mini">Vandaag {vandaag}{instellingen.maxPerDag ? ` van ${instellingen.maxPerDag}` : ''} AI-vragen gebruikt.</p>
            <p className="ab-label" style={{ marginTop: '0.8rem' }}>Pauzeren tot <Hint tekst="Handig als je ChatGPT-limiet op is: de AI doet tot dat moment niets. Na een limiet zet hij dit zelf, als ChatGPT zegt wanneer het weer kan." /></p>
            {pauzeTot && pauzeTot > new Date()
                ? <div className="ab-rij"><span>Gepauzeerd tot <strong>{pauzeTot.toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong></span>
                    <button type="button" className="ab-knop klein" onClick={() => patch({ pauzeTot: null })}>Opheffen</button></div>
                : <div className="ab-rij">
                    <input className="ab-in" type="datetime-local" value={tot} onChange={(e) => setTot(e.target.value)} />
                    <button type="button" className="ab-knop" disabled={!tot} onClick={() => { patch({ pauzeTot: new Date(tot).toISOString() }); setTot(''); }}>Pauzeren</button>
                </div>}
        </section>
    );
}

function DoelVeld({ waarde, onSave }) {
    const [w, setW] = useState(String(waarde));
    useEffect(() => setW(String(waarde)), [waarde]);
    return <input className="ab-in ab-doel" type="number" min="0" value={w} onChange={(e) => setW(e.target.value)}
        onBlur={() => { if (String(waarde) !== w) onSave(w); }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

// ------------------------------------------------------------------
// Bewerkbare velden
// ------------------------------------------------------------------

function useOpslaan(onSave) {
    const [staat, setStaat] = useState('');
    const bewaar = async (waarde) => {
        setStaat('bezig');
        try { await onSave(waarde); setStaat('ok'); setTimeout(() => setStaat(''), 1500); }
        catch (e) { setStaat('fout'); alert(e.message); }
    };
    return [staat, bewaar];
}

function Tekst({ waarde, onSave, placeholder, type = 'text', label, breed }) {
    const [w, setW] = useState(waarde ?? '');
    const [staat, bewaar] = useOpslaan(onSave);
    useEffect(() => setW(waarde ?? ''), [waarde]);
    return (
        <label className={'ab-veld' + (breed ? ' breed' : '') + (staat ? ` ${staat}` : '')}>
            {label && <span className="ab-veld-label">{label}</span>}
            <input className="ab-in" type={type} value={w} placeholder={placeholder}
                onChange={(e) => setW(e.target.value)}
                onBlur={() => { if (String(w) !== String(waarde ?? '')) bewaar(w); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </label>
    );
}

function Keuze({ waarde, opties, onSave, label, leeg }) {
    const [staat, bewaar] = useOpslaan(onSave);
    return (
        <label className={'ab-veld' + (staat ? ` ${staat}` : '')}>
            {label && <span className="ab-veld-label">{label}</span>}
            <select className="ab-in" value={waarde || ''} onChange={(e) => bewaar(e.target.value)}>
                {leeg && <option value="">{leeg}</option>}
                {opties.map(([id, naam]) => <option key={id} value={id}>{naam}</option>)}
            </select>
        </label>
    );
}

function Slot({ item, veld, onVrij }) {
    if (!(item.handmatig || []).includes(veld)) return null;
    return (
        <button type="button" className="ab-slot" title="Zelf aangepast: de AI blijft eraf. Tik om het weer aan de AI over te laten."
            onClick={() => { if (window.confirm('Dit veld weer door de AI laten bepalen?')) onVrij(veld); }}>🔒</button>
    );
}

// ------------------------------------------------------------------
// Lijst met filters, gedeeld door alle controletabs
// ------------------------------------------------------------------

function Lijst({ tab, standaardFilter = '', vasteFilter = false }) {
    const [params, setParams] = useSearchParams();
    const categorie = params.get('categorie') || '';
    const tier = params.get('tier') || '';
    const filter = params.get('filter') || standaardFilter;
    const pagina = Number(params.get('pagina')) || 1;
    const [zoek, setZoek] = useState(params.get('zoek') || '');
    const [data, setData] = useState(null);
    const [fout, setFout] = useState('');
    const zoekTimer = useRef(null);

    const zetParam = (sleutel, waarde) => {
        const p = new URLSearchParams(params);
        if (waarde) p.set(sleutel, waarde); else p.delete(sleutel);
        if (sleutel !== 'pagina') p.delete('pagina');
        setParams(p, { replace: true });
    };

    const laad = useCallback(() => {
        const q = new URLSearchParams({ tab, categorie, tier, filter, zoek: params.get('zoek') || '', pagina: String(pagina) });
        api(`/api/admin/bank/items?${q}`).then((d) => { setData(d); setFout(''); }).catch((e) => setFout(e.message));
    }, [tab, categorie, tier, filter, pagina, params]);
    useEffect(() => { laad(); }, [laad]);
    // MP3-downloads lopen op de achtergrond: ververs zolang er iets bezig is.
    useEffect(() => {
        if (!data?.items?.some((i) => i.mp3_bezig)) return undefined;
        const t = setTimeout(laad, 5000);
        return () => clearTimeout(t);
    }, [data, laad]);

    function onZoek(w) {
        setZoek(w);
        clearTimeout(zoekTimer.current);
        zoekTimer.current = setTimeout(() => zetParam('zoek', w.trim()), 400);
    }

    const werkBij = (id, veranderd) => setData((d) => d && ({
        ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...veranderd } : i)),
    }));
    const acties = useMemo(() => ({
        async patch(item, velden) {
            const r = await api(`/api/admin/bank/items/${item.id}`, { method: 'PATCH', body: velden });
            werkBij(item.id, { ...velden, handmatig: [...new Set([...(item.handmatig || []), ...(r.vast || [])])] });
        },
        async vrij(item, veld) {
            await api(`/api/admin/bank/items/${item.id}/vrijgeven`, { method: 'POST', body: { veld } });
            werkBij(item.id, { handmatig: (item.handmatig || []).filter((v) => v !== veld) });
        },
        async ai(item, wat) {
            await api(`/api/admin/bank/items/${item.id}/ai`, { method: 'POST', body: { wat } });
            werkBij(item.id, wat === 'mp3'
                ? { zoek_melding: 'Staat in de wachtrij om opnieuw te zoeken.', zoek_status: 'nieuw' }
                : wat === 'quiz' ? { ai_quiz_op: null, ai_notitie: 'AI maakt nieuwe hints en vragen…' }
                    : { ai_status: 'nieuw', ai_notitie: 'AI beoordeelt opnieuw…' });
        },
        async verwijder(item) {
            if (!window.confirm(`"${item.naam}" verwijderen, met MP3's? Is hij al eens gespeeld, dan blijft de speelgeschiedenis bewaard en gaat hij alleen uit het spel.`)) return;
            await api(`/api/admin/bank/items/${item.id}`, { method: 'DELETE' });
            setData((d) => d && ({ ...d, items: d.items.filter((i) => i.id !== item.id), totaal: d.totaal - 1 }));
        },
        laad,
    }), [laad]);

    const filters = data?.filters || [];
    return (
        <div className="ab-stapel">
            <div className="ab-filters">
                <input className="ab-in ab-zoek" type="search" placeholder="Zoek titel, nummer, artiest…" value={zoek} onChange={(e) => onZoek(e.target.value)} />
                <select className="ab-in" value={categorie} onChange={(e) => zetParam('categorie', e.target.value)}>
                    <option value="">Alle categorieën</option>
                    {CATS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
                <select className="ab-in" value={tier} onChange={(e) => zetParam('tier', e.target.value)}>
                    <option value="">Alle bekendheid</option>
                    {TIERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                    <option value="geen">Nog niet bepaald</option>
                </select>
                {!vasteFilter && <div className="ab-chips">
                    {filters.map((f) => (
                        <button key={f} type="button" className={'ab-chip' + ((data?.filter || filter) === f ? ' actief' : '')}
                            onClick={() => zetParam('filter', f)}>{FILTER_LABEL[f] || f}</button>
                    ))}
                </div>}
            </div>
            {tab === 'nummers' && <NieuwNummer onKlaar={laad} />}
            {fout && <p className="waarschuwing">{fout}</p>}
            {!data ? <p className="dim">Laden…</p> : (
                <>
                    <p className="dim ab-mini">{data.totaal} titels</p>
                    <div className={`ab-lijst ab-lijst-${tab}`}>
                        {data.items.map((item) => <Rij key={item.id} tab={tab} item={item} acties={acties} />)}
                        {!data.items.length && <p className="dim">Niets gevonden. 🎉</p>}
                    </div>
                    <Paginering totaal={data.totaal} per={data.perPagina} pagina={data.pagina} onGa={(p) => zetParam('pagina', String(p))} />
                </>
            )}
        </div>
    );
}

function Paginering({ totaal, per, pagina, onGa }) {
    const max = Math.max(1, Math.ceil(totaal / per));
    if (max === 1) return null;
    return (
        <div className="ab-rij ab-paginas">
            <button type="button" className="ab-knop" disabled={pagina <= 1} onClick={() => onGa(pagina - 1)}>← Vorige</button>
            <span className="dim">Pagina {pagina} van {max}</span>
            <button type="button" className="ab-knop" disabled={pagina >= max} onClick={() => onGa(pagina + 1)}>Volgende →</button>
        </div>
    );
}

function NieuwNummer({ onKlaar }) {
    const [naam, setNaam] = useState('');
    const [cat, setCat] = useState('film');
    const [bezig, setBezig] = useState(false);
    async function voegToe(e) {
        e.preventDefault();
        if (!naam.trim()) return;
        setBezig(true);
        try { await api('/api/admin/bank/items', { method: 'POST', body: { naam, categorie: cat } }); setNaam(''); onKlaar(); }
        catch (err) { alert(err.message); }
        finally { setBezig(false); }
    }
    return (
        <form className="ab-rij ab-nieuw" onSubmit={voegToe}>
            <input className="ab-in" placeholder="Zelf een titel toevoegen (AI vult de rest in)" value={naam} onChange={(e) => setNaam(e.target.value)} />
            <select className="ab-in" value={cat} onChange={(e) => setCat(e.target.value)}>
                {CATS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <button className="ab-knop" disabled={bezig}>Toevoegen</button>
        </form>
    );
}

// ------------------------------------------------------------------
// Rijen per tab
// ------------------------------------------------------------------

function TitelKop({ item, toonNummer = true }) {
    return (
        <div className="ab-titel">
            <strong>{item.naam}</strong>
            <span className="ab-badges">
                <span className={`ab-badge cat-${item.categorie}`}>{CAT_LABEL[item.categorie] || item.categorie}</span>
                {item.bekendheid_tier && <span className={`ab-badge tier-${item.bekendheid_tier}`}>{TIER_LABEL[item.bekendheid_tier]}</span>}
                {item.jaar && <span className="ab-badge">{jaarTekst(item)}</span>}
                {item.curatie_status === 'uitgesloten' && <span className="ab-badge uit">uit</span>}
            </span>
            {toonNummer && (item.nummer_naam || item.nummer_artiest) && (
                <span className="dim ab-mini">♪ {[item.nummer_naam, item.nummer_artiest].filter(Boolean).join(' – ')}</span>
            )}
        </div>
    );
}

function Rij({ tab, item, acties }) {
    const p = (velden) => acties.patch(item, velden);
    const vrij = (veld) => acties.vrij(item, veld);
    const slot = (veld) => <Slot item={item} veld={veld} onVrij={vrij} />;

    if (tab === 'nummers') {
        return (
            <div className="ab-item">
                <div className="ab-cel breed">
                    <Tekst label="Titel (het antwoord)" waarde={item.naam} onSave={(w) => p({ naam: w })} />{slot('naam')}
                    {item.ai_notitie && <span className="dim ab-mini">AI: {item.ai_notitie}</span>}
                    {item.uitsluit_reden && <span className="ab-rood ab-mini">{item.uitsluit_reden}</span>}
                </div>
                <div className="ab-cel"><Keuze label="Categorie" waarde={item.categorie} opties={CATS} onSave={(w) => p({ categorie: w })} />{slot('categorie')}</div>
                <div className="ab-cel"><Keuze label="Bekendheid" waarde={item.bekendheid_tier} leeg="—" opties={TIERS} onSave={(w) => p({ bekendheid_tier: w })} />{slot('tier')}</div>
                <div className="ab-cel"><Tekst label="Nummer" waarde={item.nummer_naam} onSave={(w) => p({ nummer_naam: w })} />{slot('nummer')}</div>
                <div className="ab-cel"><Tekst label="Artiest / componist" waarde={item.nummer_artiest} onSave={(w) => p({ nummer_artiest: w })} /></div>
                <div className="ab-cel ab-acties">
                    <label className="ab-check"><input type="checkbox" checked={item.curatie_status !== 'uitgesloten'}
                        onChange={(e) => p({ actief: e.target.checked, curatie_status: e.target.checked ? 'goedgekeurd' : 'uitgesloten' })} /> In het spel</label>
                    {slot('actief')}
                    <button type="button" className="ab-knop klein" onClick={() => acties.ai(item, 'alles')}>↻ AI</button>
                    <button type="button" className="ab-knop klein ab-gevaar" title="Verwijderen" onClick={() => acties.verwijder(item).catch((e) => alert(e.message))}>🗑</button>
                </div>
            </div>
        );
    }

    if (tab === 'mp3') return <Mp3Rij item={item} acties={acties} />;

    if (tab === 'hints') {
        const hints = [0, 1, 2].map((i) => (item.ai_hints || [])[i] || '');
        const bewaar = (i, w) => { const nieuw = [...hints]; nieuw[i] = w; return p({ hints: nieuw, ai_hints: nieuw.filter(Boolean) }); };
        return (
            <div className="ab-item">
                <div className="ab-cel breed"><TitelKop item={item} />{slot('hints')}</div>
                {hints.map((h, i) => (
                    <div className="ab-cel breed" key={i}><Tekst label={`Hint ${i + 1}`} waarde={h} onSave={(w) => bewaar(i, w)} /></div>
                ))}
                <div className="ab-cel ab-acties"><button type="button" className="ab-knop klein" onClick={() => acties.ai(item, 'quiz')}>↻ AI opnieuw</button></div>
            </div>
        );
    }

    if (tab === 'vragen') {
        return (
            <div className="ab-item ab-item-vragen">
                <div className="ab-cel breed"><TitelKop item={item} />{slot('vragen')}
                    <button type="button" className="ab-knop klein" onClick={() => acties.ai(item, 'quiz')}>↻ AI opnieuw</button></div>
                {(item.vragen || []).map((v) => <VraagRij key={v.id} vraag={v} onKlaar={acties.laad} />)}
                <VraagRij titelId={item.id} onKlaar={acties.laad} />
            </div>
        );
    }

    if (tab === 'jaartal') {
        return (
            <div className="ab-item">
                <div className="ab-cel breed"><TitelKop item={item} /></div>
                <div className="ab-cel"><Tekst label={['serie', 'anime'].includes(item.categorie) ? 'Beginjaar' : 'Jaartal'} type="number" waarde={item.jaar ?? ''} onSave={(w) => p({ jaar: w })} />{slot('jaar')}</div>
                {(['serie'].includes(item.categorie) || (item.categorie === 'anime' && item.type === 'serie')) && <>
                    <div className="ab-cel"><Tekst label="Eindjaar" type="number" waarde={item.serie_lopend ? '' : (item.eind_jaar ?? '')} onSave={(w) => p({ eind_jaar: w, serie_lopend: false })} /></div>
                    <div className="ab-cel"><label className="ab-check"><input type="checkbox" checked={!!item.serie_lopend}
                        onChange={(e) => p({ serie_lopend: e.target.checked, ...(e.target.checked ? { eind_jaar: null } : {}) })} /> Loopt nog</label></div>
                </>}
            </div>
        );
    }

    if (tab === 'nl') {
        return (
            <div className="ab-item">
                <div className="ab-cel breed"><TitelKop item={item} />
                    {item.uitsluit_reden && <span className="ab-rood ab-mini">{item.uitsluit_reden}</span>}</div>
                <div className="ab-cel"><Keuze label="Bekend in NL?" waarde={item.nl_bekend === 'onbekend' ? '' : item.nl_bekend} leeg="Nog niet bekeken"
                    opties={[['ja', 'Ja'], ['twijfel', 'Twijfel'], ['nee', 'Nee (uit het spel)']]}
                    onSave={(w) => p({ nl_bekend: w, curatie_status: w === 'nee' ? 'uitgesloten' : 'goedgekeurd', uitsluit_reden: w === 'nee' ? 'Niet bekend in Nederland (beheerder)' : null })} />{slot('nl')}</div>
                <div className="ab-cel"><Keuze label="Taal" waarde={item.taal} opties={[['nl', 'Nederlands'], ['en', 'Niet-Nederlands']]}
                    onSave={(w) => p({ taal: w })} />{slot('taal')}</div>
                <div className="ab-cel"><Tekst label="Land" waarde={item.land || ''} placeholder="NL, US, GB…" onSave={(w) => p({ land: w })} /></div>
                <div className="ab-cel breed"><span className="ab-veld-label">Waarom (AI)</span><span className="dim">{item.nl_reden || '—'}</span></div>
            </div>
        );
    }

    if (tab === 'antwoorden') {
        const ook = [item.franchise, ...(item.aliassen || [])].filter(Boolean);
        return (
            <div className="ab-item">
                <div className="ab-cel breed"><TitelKop item={item} toonNummer={false} />
                    <span className="dim ab-mini">Ook goed: {ook.length ? ook.join(', ') : '—'}{['film', 'serie', 'anime', 'game'].includes(item.categorie) ? ' · plus andere delen uit dezelfde reeks' : ''}</span></div>
                <div className="ab-cel"><Tekst label="Franchise / reeks" waarde={item.franchise} onSave={(w) => p({ franchise: w })} />{slot('franchise')}</div>
                <div className="ab-cel breed"><Tekst label="Andere namen (komma's)" waarde={(item.aliassen || []).join(', ')}
                    onSave={(w) => p({ aliassen: w.split(',').map((x) => x.trim()).filter(Boolean) })} />{slot('aliassen')}</div>
                {item.categorie === 'anime' && (
                    <div className="ab-cel"><label className="ab-check"><input type="checkbox" checked={!!item.anime_breed_bekend}
                        onChange={(e) => p({ anime_breed_bekend: e.target.checked })} /> Ook in film/serie-quiz</label></div>
                )}
            </div>
        );
    }
    return null;
}

function Mp3Rij({ item, acties }) {
    const [url, setUrl] = useState('');
    const [bezig, setBezig] = useState(false);
    async function plaats() {
        if (!url.trim()) return;
        setBezig(true);
        try {
            await api(`/api/admin/bank/items/${item.id}/mp3/url`, { method: 'POST', body: { url } });
            setUrl('');
            setTimeout(acties.laad, 1500);
        } catch (e) { alert(e.message); }
        finally { setBezig(false); }
    }
    async function afkeuren() {
        if (!window.confirm('Deze MP3 afkeuren? De AI zoekt dan een andere versie.')) return;
        await api(`/api/admin/bank/items/${item.id}/mp3/afkeuren`, { method: 'POST' }).catch((e) => alert(e.message));
        acties.laad();
    }
    const heeft = !!item.mp3_url;
    const volgende = item.volgende_poging ? new Date(item.volgende_poging) : null;
    const reden = item.mp3_bezig ? 'Bezig met downloaden…'
        : item.zoek_melding || (item.zoek_status === 'nieuw' ? 'Nog niet gezocht; staat in de wachtrij.' : 'Nog geen MP3.');
    return (
        <div className="ab-item">
            <div className="ab-cel breed">
                <TitelKop item={item} />
                {item.yt_zoekterm && <span className="dim ab-mini">Zoekterm: {item.yt_zoekterm}</span>}
            </div>
            <div className="ab-cel breed">
                {heeft ? (
                    <>
                        {item.wacht_op_swipe && <span className="ab-badge tier-iconisch">Wacht op jouw swipe</span>}
                        <audio className="ab-audio" controls preload="none" src={item.mp3_url} />
                        <span className="dim ab-mini">{item.youtube_titel || 'Lokale MP3'}{item.verificatie_reden ? ` · ${item.verificatie_reden}` : ''}</span>
                    </>
                ) : (
                    <>
                        <span className={item.zoek_status === 'opgegeven' ? 'ab-rood' : ''}><strong>{item.zoek_status === 'opgegeven' ? 'Opgegeven' : 'Mist'}</strong> — {reden}</span>
                        <span className="dim ab-mini">{item.zoek_pogingen || 0} pogingen{volgende && volgende > new Date() ? ` · volgende ${volgende.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                    </>
                )}
                <Slot item={item} veld="mp3" onVrij={(v) => acties.vrij(item, v)} />
            </div>
            <div className="ab-cel breed ab-acties">
                <div className="ab-rij">
                    <input className="ab-in" placeholder="Eigen YouTube-link" value={url} onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && plaats()} />
                    <button type="button" className="ab-knop klein" disabled={bezig || item.mp3_bezig} onClick={plaats}>Plaats</button>
                </div>
                <div className="ab-rij">
                    <button type="button" className="ab-knop klein" disabled={item.mp3_bezig} onClick={() => acties.ai(item, 'mp3')}>↻ Opnieuw zoeken</button>
                    {heeft && <button type="button" className="ab-knop klein rood" onClick={afkeuren}>✕ Verkeerd nummer</button>}
                </div>
            </div>
        </div>
    );
}

function VraagRij({ vraag, titelId, onKlaar }) {
    const nieuw = !vraag;
    const [v, setV] = useState(vraag?.vraag || '');
    const [juist, setJuist] = useState(vraag?.juist || '');
    const [fout, setFout] = useState((vraag?.fout || []).join(', '));
    const [staat, setStaat] = useState('');
    const origineel = useRef({ v, juist, fout });

    async function bewaar() {
        if (nieuw) return;
        const o = origineel.current;
        if (o.v === v && o.juist === juist && o.fout === fout) return;
        setStaat('bezig');
        try {
            await api(`/api/admin/bank/vragen/${vraag.id}`, { method: 'PATCH', body: { vraag: v, juist, fout } });
            origineel.current = { v, juist, fout };
            setStaat('ok'); setTimeout(() => setStaat(''), 1500);
        } catch (e) { setStaat('fout'); alert(e.message); }
    }
    async function voegToe() {
        try {
            await api(`/api/admin/bank/items/${titelId}/vragen`, { method: 'POST', body: { vraag: v, juist, fout } });
            setV(''); setJuist(''); setFout('');
            onKlaar();
        } catch (e) { alert(e.message); }
    }
    async function wis() {
        if (!window.confirm('Deze vraag verwijderen?')) return;
        await api(`/api/admin/bank/vragen/${vraag.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
        onKlaar();
    }
    const blur = { onBlur: bewaar, onKeyDown: (e) => e.key === 'Enter' && e.currentTarget.blur() };
    return (
        <div className={'ab-vraag' + (nieuw ? ' nieuw' : '') + (staat ? ` ${staat}` : '')}>
            <input className="ab-in" placeholder={nieuw ? 'Nieuwe vraag' : 'Vraag'} value={v} onChange={(e) => setV(e.target.value)} {...blur} />
            <input className="ab-in ab-goed" placeholder="Goed antwoord" value={juist} onChange={(e) => setJuist(e.target.value)} {...blur} />
            <input className="ab-in" placeholder="5 foute antwoorden, met komma's" value={fout} onChange={(e) => setFout(e.target.value)} {...blur} />
            {nieuw
                ? <button type="button" className="ab-knop klein" onClick={voegToe}>Toevoegen</button>
                : <button type="button" className="ab-knop klein rood" onClick={wis} title="Verwijderen">✕</button>}
        </div>
    );
}

// ------------------------------------------------------------------
// AI-log
// ------------------------------------------------------------------

const LOG_LABEL = {
    '': 'Alles', beoordeling: 'Beoordeling', uitgesloten: 'Uitgesloten', quiz: 'Hints & vragen', mp3: 'MP3',
    aanvulling: 'Aanvulling', verbeterpunt: 'Verbeterpunten', fout: 'Fouten', systeem: 'Systeem',
};

// ------------------------------------------------------------------
// Collecties: zelf een thema maken (Sinterklaas, Rock …); de AI deelt
// bestaande nummers in en vult aan. Eén nummer kan in meerdere collecties.
// ------------------------------------------------------------------

const SOORT_OPTIES = [
    ['muziek', 'Muziek (op nummer — ook films/series/games met een passend nummer)'],
    ['beide', 'Films, series & anime'],
    ['film', 'Alleen films'],
    ['serie', 'Alleen series'],
    ['alles', 'Alles'],
];
const SOORT_KORT = { muziek: 'Muziek', beide: 'Films & series', film: 'Films', serie: 'Series', alles: 'Alles' };

function Collecties({ gekozen, onKies }) {
    const [lijst, setLijst] = useState(null);
    const [fout, setFout] = useState('');
    const laad = useCallback(() => {
        api('/api/admin/bank/collecties').then((d) => { setLijst(d.items); setFout(''); }).catch((e) => setFout(e.message));
    }, []);
    useEffect(() => { laad(); const t = setInterval(laad, 15000); return () => clearInterval(t); }, [laad]);
    const actief = lijst?.find((c) => String(c.id) === String(gekozen));
    if (fout) return <p className="waarschuwing">{fout}</p>;
    if (!lijst) return <p className="dim">Laden…</p>;
    if (actief) return <CollectieDetail c={actief} onTerug={() => onKies('')} onWijzig={laad} />;
    return (
        <div className="ab-stapel">
            <NieuweCollectie onKlaar={(c) => { laad(); if (c?.id) onKies(c.id); }} />
            <section className="ab-kaart">
                <p className="ab-label">Collecties ({lijst.length}) <Hint tekst="★ = voorrang: de AI deelt deze eerst in en zoekt eerst hun MP3's, hints en vragen. Alleen actieve collecties met speelbare nummers staan in Nieuw spel." /></p>
                <div className="ab-collecties">
                    {lijst.map((c) => (
                        <button key={c.id} type="button" className={'ab-collectie' + (c.actief ? '' : ' uit')} onClick={() => onKies(c.id)}>
                            <span className="ab-collectie-emoji">{c.afbeelding_url ? <img src={c.afbeelding_url} alt="" /> : (c.emoji || '✨')}</span>
                            <span className="ab-collectie-tekst">
                                <strong>{c.voorrang ? '★ ' : ''}{c.naam}</strong>
                                <span className="dim ab-mini">{SOORT_KORT[c.standaard_type] || c.standaard_type} · {c.aantal} items · {c.speelbaar} speelbaar{c.ai_doel ? ` · doel ${c.ai_doel}` : ''}</span>
                                <span className="dim ab-mini">{!c.ai_aan ? 'AI uit' : !c.scan_klaar ? `AI deelt in… ${c.scan_procent}%` : c.aantal < c.ai_doel ? (c.ai_uitgeput_tot && new Date(c.ai_uitgeput_tot) > new Date() ? 'AI weet even niets nieuws' : 'AI vult aan') : 'Op doel'}{!c.actief ? ' · niet in spel' : ''}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

// Kies een emoji uit een raster of upload een eigen plaatje.
const EMOJIS = ['🎁', '🎅', '🎄', '⛄', '🐴', '🍫', '🎸', '🤘', '🎤', '🎧', '🎹', '🥁', '🎺', '🎻', '🪩', '💃',
    '🕺', '🇳🇱', '🌷', '🧡', '🍺', '☀️', '🏖️', '🌴', '🎃', '👻', '💘', '❤️', '🏆', '⚽', '🏎️', '🚀',
    '🦸', '🧙', '🐉', '🏰', '👑', '🤖', '👾', '🎮', '🕹️', '🎬', '📺', '📼', '🍿', '🎭', '🌌', '🦖',
    '🧸', '🎈', '🎂', '🎉', '🍸', '🕵️', '🔫', '🚓', '🏴‍☠️', '⚔️', '🌸', '🍣', '🐼', '⭐'];
function EmojiKiezer({ waarde, onKies, plaatje, onUpload, onWisPlaatje }) {
    const [open, setOpen] = useState(false);
    const bestand = useRef(null);
    return (
        <span className="ab-emoji-kiezer">
            <button type="button" className="ab-in ab-emoji-knop" onClick={() => setOpen((o) => !o)} aria-label="Plaatje kiezen">
                {plaatje ? <img src={plaatje} alt="" /> : (waarde || '✨')}
            </button>
            {open && (
                <span className="ab-emoji-paneel">
                    <span className="ab-emoji-raster">
                        {EMOJIS.map((e) => (
                            <button key={e} type="button" className={e === waarde && !plaatje ? 'actief' : ''}
                                onClick={() => { onKies(e); setOpen(false); }}>{e}</button>
                        ))}
                    </span>
                    {onUpload && (
                        <span className="ab-rij">
                            <button type="button" className="ab-knop klein" onClick={() => bestand.current?.click()}>⬆ Eigen plaatje</button>
                            {plaatje && <button type="button" className="ab-knop klein" onClick={() => { onWisPlaatje(); setOpen(false); }}>Plaatje weg</button>}
                            <input ref={bestand} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUpload(f); setOpen(false); } e.target.value = ''; }} />
                        </span>
                    )}
                </span>
            )}
        </span>
    );
}

async function uploadPlaatje(id, bestand) {
    const form = new FormData();
    form.append('afbeelding', bestand);
    const r = await fetch(`/api/admin/bank/collecties/${id}/afbeelding`, { method: 'POST', credentials: 'include', body: form });
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error(d?.fout || `Uploaden mislukt (fout ${r.status}).`);
    return d;
}

function NieuweCollectie({ onKlaar }) {
    const [naam, setNaam] = useState('');
    const [criteria, setCriteria] = useState('');
    const [soort, setSoort] = useState('muziek');
    const [doel, setDoel] = useState('60');
    const [emoji, setEmoji] = useState('🎁');
    const [plaatje, setPlaatje] = useState(null);
    const voorbeeld = useMemo(() => (plaatje ? URL.createObjectURL(plaatje) : null), [plaatje]);
    const [bezig, setBezig] = useState(false);
    async function maak(e) {
        e.preventDefault();
        if (!naam.trim()) return;
        setBezig(true);
        try {
            const c = await api('/api/admin/bank/collecties', { method: 'POST', body: { naam, criteria, soort, doel: Number(doel), emoji } });
            if (plaatje) await uploadPlaatje(c.id, plaatje).catch((e) => alert(e.message));
            setNaam(''); setCriteria(''); setEmoji('🎁'); setPlaatje(null);
            onKlaar(c);
        } catch (err) { alert(err.message); }
        finally { setBezig(false); }
    }
    return (
        <form className="ab-kaart ab-nieuwe-collectie" onSubmit={maak}>
            <p className="ab-label">Nieuwe collectie via AI <Hint tekst="De AI zoekt eerst in de hele database wat erbij past (Rocky met Eye of the Tiger komt ook in Rock, zonder dubbele MP3) en vult daarna aan tot het doel. Nieuwe nummers krijgen vanzelf MP3, hints en vragen." /></p>
            <div className="ab-rij">
                <EmojiKiezer waarde={emoji} onKies={(e) => { setEmoji(e); setPlaatje(null); }}
                    plaatje={voorbeeld} onUpload={setPlaatje} onWisPlaatje={() => setPlaatje(null)} />
                <input className="ab-in" placeholder="Naam, bv. Sinterklaas" value={naam} onChange={(e) => setNaam(e.target.value)} />
            </div>
            <textarea className="ab-in" rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)}
                placeholder="Wat hoort erin? bv. Sinterklaasliedjes die iedereen kent (Zie ginds komt de stoomboot, Sinterklaas kapoentje) en bekende Sinterklaas-hits" />
            <div className="ab-rij">
                <select className="ab-in" value={soort} onChange={(e) => setSoort(e.target.value)}>
                    {SOORT_OPTIES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
                <label className="ab-veld"><span className="ab-veld-label">Doel</span>
                    <input className="ab-in ab-doel" type="number" min="0" value={doel} onChange={(e) => setDoel(e.target.value)} /></label>
                <button className="ab-knop" disabled={bezig || !naam.trim()}>{bezig ? 'Bezig…' : 'Maak & laat AI vullen'}</button>
            </div>
        </form>
    );
}

function CollectieDetail({ c, onTerug, onWijzig }) {
    const [leden, setLeden] = useState(null);
    const [zoek, setZoek] = useState('');
    const [toevoegen, setToevoegen] = useState('');
    const [treffers, setTreffers] = useState([]);
    const laadLeden = useCallback(() => {
        api(`/api/admin/bank/collecties/${c.id}/leden?zoek=${encodeURIComponent(zoek)}`).then((d) => setLeden(d.items)).catch((e) => alert(e.message));
    }, [c.id, zoek]);
    useEffect(() => { const t = setTimeout(laadLeden, 250); return () => clearTimeout(t); }, [laadLeden]);
    useEffect(() => {
        if (toevoegen.trim().length < 2) { setTreffers([]); return undefined; }
        const t = setTimeout(() => {
            api(`/api/admin/bank/collecties/${c.id}/zoek?q=${encodeURIComponent(toevoegen)}`).then((d) => setTreffers(d.items)).catch(() => {});
        }, 250);
        return () => clearTimeout(t);
    }, [c.id, toevoegen]);
    const patch = async (velden) => { await api(`/api/admin/bank/collecties/${c.id}`, { method: 'PATCH', body: velden }); onWijzig(); };
    async function voegToe(t) {
        try { await api(`/api/admin/bank/collecties/${c.id}/leden`, { method: 'POST', body: { titel_id: t.id } }); setToevoegen(''); laadLeden(); onWijzig(); }
        catch (e) { alert(e.message); }
    }
    async function haalWeg(t) {
        setLeden((l) => l.filter((x) => x.id !== t.id));
        try { await api(`/api/admin/bank/collecties/${c.id}/leden/${t.id}`, { method: 'DELETE' }); onWijzig(); }
        catch (e) { alert(e.message); laadLeden(); }
    }
    async function opnieuw() {
        await api(`/api/admin/bank/collecties/${c.id}/opnieuw`, { method: 'POST' }).catch((e) => alert(e.message));
        onWijzig();
    }
    async function verwijder() {
        if (!window.confirm(`Collectie "${c.naam}" verwijderen? De nummers zelf blijven gewoon in de database.`)) return;
        await api(`/api/admin/bank/collecties/${c.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
        onWijzig(); onTerug();
    }
    return (
        <div className="ab-stapel">
            <section className="ab-kaart">
                <div className="ab-rij">
                    <button type="button" className="ab-knop klein" onClick={onTerug}>← Alle collecties</button>
                    <EmojiKiezer waarde={c.emoji} plaatje={c.afbeelding_url} onKies={(e) => patch({ emoji: e })}
                        onUpload={async (f) => { try { await uploadPlaatje(c.id, f); onWijzig(); } catch (e) { alert(e.message); } }}
                        onWisPlaatje={async () => { await api(`/api/admin/bank/collecties/${c.id}/afbeelding`, { method: 'DELETE' }).catch(() => {}); onWijzig(); }} />
                    <strong className="ab-collectie-kop">{c.naam}</strong>
                    <span className="dim ab-mini">{c.aantal} items · {c.speelbaar} speelbaar · {c.door_ai} door AI</span>
                </div>
                <div className="ab-chips" style={{ marginTop: '0.6rem' }}>
                    <button type="button" className={'ab-chip' + (c.voorrang ? ' actief' : '')} onClick={() => patch({ voorrang: !c.voorrang })}>{c.voorrang ? '★ Voorrang' : '☆ Voorrang'}</button>
                    <button type="button" className={'ab-chip' + (c.actief ? ' actief' : '')} onClick={() => patch({ actief: !c.actief })}>{c.actief ? '✓ In Nieuw spel' : 'Niet in Nieuw spel'}</button>
                    <button type="button" className={'ab-chip' + (c.ai_aan ? ' actief' : '')} onClick={() => patch({ ai_aan: !c.ai_aan })}>{c.ai_aan ? '✓ AI beheert' : 'AI uit'}</button>
                </div>
                <p className="dim ab-mini">{!c.ai_aan ? 'De AI doet niets met deze collectie.' : !c.scan_klaar ? `De AI loopt de database na: ${c.scan_procent}%.` : c.aantal < c.ai_doel ? 'Database nagelopen; de AI vult aan tot het doel.' : 'Op doel. Verhoog het doel voor meer.'}</p>
                <div className="ab-velden">
                    <Tekst label="Naam" waarde={c.naam} onSave={(v) => patch({ naam: v })} />
                    <Tekst label="Doel" type="number" waarde={c.ai_doel} onSave={(v) => patch({ ai_doel: Number(v) })} />
                    <Keuze label="Soort" waarde={c.standaard_type} opties={SOORT_OPTIES.map(([id]) => [id, SOORT_KORT[id]])} onSave={(v) => patch({ standaard_type: v })} />
                    <Tekst label="Wat hoort erin (voor de AI)" breed waarde={c.ai_criteria || c.beschrijving || ''} onSave={(v) => patch({ ai_criteria: v })} />
                </div>
                <div className="ab-rij" style={{ marginTop: '0.6rem' }}>
                    <button type="button" className="ab-knop klein" onClick={opnieuw}>↻ AI opnieuw laten indelen</button>
                    <button type="button" className="ab-knop klein ab-gevaar" onClick={verwijder}>Verwijderen</button>
                </div>
            </section>
            <section className="ab-kaart">
                <p className="ab-label">Zelf toevoegen uit de database</p>
                <input className="ab-in" placeholder="Zoek een titel of nummer, bv. Eye of the Tiger" value={toevoegen} onChange={(e) => setToevoegen(e.target.value)} />
                {treffers.length > 0 && (
                    <ul className="ab-treffers">
                        {treffers.map((t) => (
                            <li key={t.id}><button type="button" onClick={() => voegToe(t)}>
                                + {t.naam} <span className="dim">({CAT_LABEL[t.categorie] || t.categorie}{t.jaar ? `, ${t.jaar}` : ''}{t.nummer_naam && t.nummer_naam !== t.naam ? ` · ♪ ${t.nummer_naam}` : ''})</span>
                            </button></li>
                        ))}
                    </ul>
                )}
            </section>
            <section className="ab-kaart">
                <div className="ab-rij">
                    <p className="ab-label">Inhoud</p>
                    <input className="ab-in" placeholder="Zoeken…" value={zoek} onChange={(e) => setZoek(e.target.value)} />
                </div>
                {!leden ? <p className="dim">Laden…</p> : !leden.length ? <p className="dim">Nog leeg — de AI is ermee bezig.</p> : (
                    <ul className="ab-leden">
                        {leden.map((t) => (
                            <li key={t.id}>
                                <TitelKop item={t} />
                                <span className="ab-badges">
                                    {!t.speelbaar && <span className="ab-badge uit">geen MP3</span>}
                                    <span className="ab-badge">{t.bron === 'ai' ? 'AI' : 'zelf'}</span>
                                </span>
                                <button type="button" className="ab-knop klein" title="Uit deze collectie halen (de AI zet hem niet terug)" onClick={() => haalWeg(t)}>✕</button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

// ------------------------------------------------------------------
// Dubbelen: luisteren, vergelijken en opruimen
// ------------------------------------------------------------------

function Dubbelen() {
    const [alleenMp3, setAlleenMp3] = useState(true);
    const [data, setData] = useState(null);
    const [bezig, setBezig] = useState(false);
    const laad = useCallback(() => {
        setData(null);
        api(`/api/admin/bank/dubbelen?mp3=${alleenMp3 ? 1 : 0}`).then(setData).catch((e) => alert(e.message));
    }, [alleenMp3]);
    useEffect(() => { laad(); }, [laad]);
    // Lokaal bijwerken, zodat je niet steeds naar boven springt.
    const zonder = (pred) => setData((d) => d && ({
        ...d,
        groepen: d.groepen.map((g) => ({ ...g, items: g.items.map(pred).filter(Boolean) })).filter((g) => g.items.length > 1),
    }));
    async function mp3Weg(item, mp3) {
        try {
            await api(`/api/admin/bank/tracks/${mp3.id}`, { method: 'DELETE' });
            zonder((i) => (i.id === item.id ? { ...i, mp3s: i.mp3s.filter((m) => m.id !== mp3.id) } : i));
        } catch (e) { alert(e.message); }
    }
    async function titelWeg(item) {
        if (!window.confirm(`"${item.naam}" (#${item.id}) verwijderen, met MP3's?`)) return;
        try {
            await api(`/api/admin/bank/items/${item.id}`, { method: 'DELETE' });
            zonder((i) => (i.id === item.id ? null : i));
        } catch (e) { alert(e.message); }
    }
    async function opruimen() {
        if (!window.confirm(`Alle ${data.uitgesloten_dubbel} uitgesloten dubbelen verwijderen, met hun MP3's? Wat al eens gespeeld is, blijft als geschiedenis bewaard.`)) return;
        setBezig(true);
        try { const r = await api('/api/admin/bank/opruimen/dubbelen', { method: 'POST' }); alert(r.tekst); laad(); }
        catch (e) { alert(e.message); }
        finally { setBezig(false); }
    }
    return (
        <div className="ab-stapel">
            <section className="ab-kaart">
                <div className="ab-rij">
                    <label className="ab-check"><input type="checkbox" checked={alleenMp3} onChange={(e) => setAlleenMp3(e.target.checked)} /> Alleen met meerdere MP3's</label>
                    <Hint tekst="Titels met dezelfde naam of hetzelfde nummer. Luister en verwijder de MP3 of titel die je niet wilt houden (bv. de Engelse versie als de Nederlandse beter is)." />
                    {data?.uitgesloten_dubbel > 0 && (
                        <button type="button" className="ab-knop" disabled={bezig} onClick={opruimen}>🧹 {data.uitgesloten_dubbel} uitgesloten dubbelen opruimen</button>
                    )}
                </div>
            </section>
            {!data ? <p className="dim">Laden…</p> : !data.groepen.length ? <p className="dim">Geen dubbelen. 🎉</p> : data.groepen.map((g) => (
                <section key={g.items.map((i) => i.id).join('-')} className="ab-kaart ab-dubbel">
                    <span className="ab-badge">{g.reden}</span>
                    {g.items.map((item) => (
                        <div key={item.id} className={'ab-dubbel-item' + (item.curatie_status === 'uitgesloten' ? ' uit' : '')}>
                            <div className="ab-dubbel-kop">
                                <TitelKop item={item} />
                                <span className="dim ab-mini">#{item.id}{item.uitsluit_reden ? ` · ${item.uitsluit_reden}` : ''}</span>
                                <button type="button" className="ab-knop klein ab-gevaar" onClick={() => titelWeg(item)}>🗑 Titel</button>
                            </div>
                            {!item.mp3s.length ? <span className="dim ab-mini">Geen MP3</span> : item.mp3s.map((m) => (
                                <div key={m.id} className="ab-dubbel-mp3">
                                    <audio controls preload="none" src={m.mp3_url} />
                                    <span className="dim ab-mini">{m.youtube_titel || 'MP3'}{m.wacht ? ' · nog niet geswiped' : ''}</span>
                                    <button type="button" className="ab-knop klein ab-gevaar" onClick={() => mp3Weg(item, m)}>🗑 MP3</button>
                                </div>
                            ))}
                        </div>
                    ))}
                </section>
            ))}
        </div>
    );
}

function Log() {
    const [soort, setSoort] = useState('');
    const [pagina, setPagina] = useState(1);
    const [items, setItems] = useState(null);
    const laad = useCallback(() => {
        api(`/api/admin/bank/log?soort=${soort}&pagina=${pagina}`).then((d) => setItems(d.items)).catch(() => setItems([]));
    }, [soort, pagina]);
    useEffect(() => {
        laad();
        const t = setInterval(laad, 10000);
        return () => clearInterval(t);
    }, [laad]);
    return (
        <div className="ab-stapel">
            <div className="ab-chips">
                {Object.entries(LOG_LABEL).map(([id, n]) => (
                    <button key={id} type="button" className={'ab-chip' + (soort === id ? ' actief' : '')}
                        onClick={() => { setSoort(id); setPagina(1); }}>{n}</button>
                ))}
            </div>
            {!items ? <p className="dim">Laden…</p> : (
                <ul className="ab-log">
                    {items.map((r) => (
                        <li key={r.id}>
                            <span className="dim ab-mini">{new Date(r.aangemaakt_op).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            <span className={`ab-badge log-${r.soort}`}>{LOG_LABEL[r.soort] || r.soort}</span>
                            <span>{r.bericht}</span>
                        </li>
                    ))}
                    {!items.length && <li className="dim">Nog niets gelogd.</li>}
                </ul>
            )}
            <div className="ab-rij ab-paginas">
                <button type="button" className="ab-knop" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Nieuwer</button>
                <button type="button" className="ab-knop" disabled={(items || []).length < 100} onClick={() => setPagina(pagina + 1)}>Ouder →</button>
            </div>
        </div>
    );
}
