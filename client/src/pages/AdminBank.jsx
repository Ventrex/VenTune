import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import { ChatGptKoppeling } from './AdminAI.jsx';
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

const TABS = [
    ['overzicht', 'Overzicht'], ['nummers', 'Nummers'], ['mp3', 'MP3'], ['hints', 'Hints'],
    ['vragen', 'Vragen'], ['jaartal', 'Jaartal'], ['nl', 'NL-check'], ['antwoorden', 'Antwoorden'], ['log', 'AI-log'],
];
const CATS = [['film', 'Films'], ['serie', 'Series'], ['anime', 'Anime'], ['game', 'Videogames'], ['muziek', 'Muziek'], ['kerst', 'Kerst'], ['kinder', 'Kinder']];
const CAT_LABEL = Object.fromEntries(CATS);
const TIERS = [['iconisch', 'Iconisch'], ['algemeen_bekend', 'Algemeen bekend'], ['bekend', 'Bekend'], ['onbekend', 'Onbekend'], ['cult', 'Cult']];
const TIER_LABEL = Object.fromEntries(TIERS);
const FILTER_LABEL = {
    alle: 'Alles', te_beoordelen: 'Nog bij AI', handmatig: 'Zelf aangepast', uitgesloten: 'Uitgesloten',
    mist: 'Mist', opgegeven: 'Opgegeven', aanwezig: 'Aanwezig', leeg: 'Onvolledig',
    nee: 'Niet bekend', twijfel: 'Twijfel', ja: 'Bekend', zonder_franchise: 'Zonder franchise', anime: 'Anime',
};
const STAP_LABEL = {
    opstarten: 'Opstarten', beoordelen: 'Beoordelen', mp3: 'MP3 zoeken', quiz: 'Hints & vragen',
    aanvullen: 'Aanvullen', verbeteren: 'Verbeterpunten', pauze: 'Even pauze', klaar: 'Alles bijgewerkt',
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
    const tab = TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overzicht';
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
    // Op een telefoon de actieve tab in beeld schuiven.
    useEffect(() => {
        document.querySelector('.ab-tab.actief')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }, [tab]);

    return (
        <main className="ab">
            <header className="ab-kop">
                <Brand link compact />
                <h1>Vragenbank</h1>
                <Link className="ab-link" to="/admin">Overig beheer →</Link>
            </header>
            {fout && <p className="waarschuwing">{fout}</p>}
            <WorkerBalk status={status} onWijzig={laadStatus} />
            <nav className="ab-tabs" aria-label="Controles">
                {TABS.map(([id, naam]) => (
                    <button key={id} type="button" className={'ab-tab' + (tab === id ? ' actief' : '')}
                        onClick={() => ga(id)}>{naam}{tabTeller(id, status)}</button>
                ))}
            </nav>
            {tab === 'overzicht' && <Overzicht status={status} onWijzig={laadStatus} ga={ga} />}
            {tab === 'log' && <Log />}
            {tab !== 'overzicht' && tab !== 'log' && <Lijst key={tab} tab={tab} />}
        </main>
    );
}

function tabTeller(id, status) {
    const v = status?.voorraad;
    if (!v) return null;
    const n = { mp3: v.zonder_mp3, hints: v.zonder_hints, vragen: v.zonder_vragen, nl: v.nl_twijfel }[id];
    return n ? <span className="ab-teller">{n > 999 ? '999+' : n}</span> : null;
}

// ------------------------------------------------------------------
// Statusbalk van de AI-curator
// ------------------------------------------------------------------

function WorkerBalk({ status, onWijzig }) {
    if (!status) return <div className="ab-balk"><span className="dim">Status laden…</span></div>;
    const w = status.worker;
    const aan = status.instellingen.aan;
    const bezig = !['uit', 'wacht', 'fout', 'klaar'].includes(w.stap);
    async function zet(nieuw) {
        await api('/api/admin/bank/worker', { method: 'POST', body: { aan: nieuw } }).catch(() => {});
        onWijzig();
    }
    return (
        <section className={'ab-balk' + (aan ? '' : ' uit')}>
            <span className={'ab-stip ' + (!aan ? 'uit' : w.stap === 'fout' || w.stap === 'wacht' ? 'let-op' : bezig ? 'bezig' : 'ok')} />
            <div className="ab-balk-tekst">
                <strong>AI-curator: {aan ? (STAP_LABEL[w.stap] || w.stap) : 'uit'}</strong>
                <span className="dim">{w.bericht}</span>
                {w.laatsteActie && <span className="dim">Laatst: {w.laatsteActie}</span>}
                {w.laatsteFout && <span className="ab-rood">Fout: {w.laatsteFout}</span>}
            </div>
            <div className="ab-balk-cijfers dim">
                {w.tellers.beoordeeld} beoordeeld · {w.tellers.mp3} MP3 · {w.tellers.quiz} quiz · {w.tellers.toegevoegd} nieuw · {w.tellers.verbeterd} verbeterd
            </div>
            <button type="button" className="ab-knop" onClick={() => zet(!aan)}>{aan ? 'Pauzeren' : 'Aanzetten'}</button>
        </section>
    );
}

// ------------------------------------------------------------------
// Overzicht
// ------------------------------------------------------------------

function Overzicht({ status, onWijzig, ga }) {
    const [pauze, setPauze] = useState('');
    if (!status) return null;
    const { tellingen, instellingen, voorraad, chatgpt } = status;
    async function verhoog(cat, erbij) {
        await api(`/api/admin/bank/doel/${cat}`, { method: 'POST', body: { erbij } }).catch((e) => alert(e.message));
        onWijzig();
    }
    async function zetDoel(cat, waarde) {
        await api('/api/admin/bank/instellingen', { method: 'PATCH', body: { doelen: { [cat]: Number(waarde) } } }).catch((e) => alert(e.message));
        onWijzig();
    }
    async function zetPauze() {
        if (!pauze) return;
        await api('/api/admin/bank/instellingen', { method: 'PATCH', body: { pauzeSeconden: Number(pauze) } }).catch((e) => alert(e.message));
        setPauze('');
        onWijzig();
    }
    const tegels = [
        ['Nog door AI te beoordelen', voorraad.te_beoordelen, 'nummers', { filter: 'te_beoordelen' }],
        ['Zonder MP3', voorraad.zonder_mp3, 'mp3', { filter: 'mist' }],
        ['MP3 opgegeven (jij kijken)', voorraad.mp3_opgegeven, 'mp3', { filter: 'opgegeven' }],
        ['Zonder 3 hints', voorraad.zonder_hints, 'hints', { filter: 'leeg' }],
        ['Zonder bonusvragen', voorraad.zonder_vragen, 'vragen', { filter: 'leeg' }],
        ['NL: twijfel', voorraad.nl_twijfel, 'nl', { filter: 'twijfel' }],
        ['Niet bekend in NL (uit)', voorraad.nl_nee, 'nl', { filter: 'nee' }],
        ['Uitgesloten totaal', voorraad.uitgesloten, 'nummers', { filter: 'uitgesloten' }],
    ];
    return (
        <div className="ab-stapel">
            {!chatgpt.gekoppeld && (
                <section className="ab-kaart">
                    <p className="ab-label">ChatGPT koppelen</p>
                    <p className="dim">Zonder koppeling kan de AI-curator niets doen. Eén keer koppelen is genoeg.</p>
                    <ChatGptKoppeling />
                </section>
            )}
            <section className="ab-kaart">
                <p className="ab-label">Per categorie en bekendheid</p>
                <div className="ab-scroll">
                    <table className="ab-matrix">
                        <thead><tr>
                            <th>Categorie</th>{TIERS.map(([id, n]) => <th key={id}>{n}</th>)}<th>Nog niet</th>
                            <th>Totaal</th><th>Speelbaar</th><th>Doel</th><th>Erbij</th>
                        </tr></thead>
                        <tbody>{CATS.map(([cat, naam]) => {
                            const t = tellingen[cat] || { totaal: 0, speelbaar: 0, tiers: {} };
                            const doel = instellingen.doelen[cat] || 0;
                            return (
                                <tr key={cat}>
                                    <th><button type="button" className="ab-linkknop" onClick={() => ga('nummers', { categorie: cat })}>{naam}</button></th>
                                    {TIERS.map(([id]) => (
                                        <td key={id}>
                                            <button type="button" className="ab-linkknop" onClick={() => ga('nummers', { categorie: cat, tier: id })}>
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
                                </tr>
                            );
                        })}</tbody>
                    </table>
                </div>
                <p className="dim ab-mini">Staat een categorie onder het doel, dan vult de AI hem aan met titels die in Nederland bekend zijn, verdeeld over de bekendheidsniveaus.</p>
            </section>
            <section className="ab-tegels">
                {tegels.map(([naam, n, t, extra]) => (
                    <button key={naam} type="button" className="ab-tegel" onClick={() => ga(t, extra)}>
                        <strong>{n ?? 0}</strong><span>{naam}</span>
                    </button>
                ))}
            </section>
            <section className="ab-kaart">
                <p className="ab-label">Tempo</p>
                <p className="dim">Pauze tussen twee AI-vragen: <strong>{instellingen.pauzeSeconden} s</strong>. Hoger = rustiger voor je ChatGPT-abonnement.</p>
                <div className="ab-rij">
                    <input className="ab-in" type="number" min="5" max="600" placeholder="Seconden" value={pauze} onChange={(e) => setPauze(e.target.value)} />
                    <button type="button" className="ab-knop" onClick={zetPauze}>Opslaan</button>
                </div>
                {chatgpt.gekoppeld && <p className="dim ab-mini">ChatGPT is gekoppeld.</p>}
            </section>
        </div>
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

function Lijst({ tab }) {
    const [params, setParams] = useSearchParams();
    const categorie = params.get('categorie') || '';
    const tier = params.get('tier') || '';
    const filter = params.get('filter') || '';
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
                <div className="ab-chips">
                    {filters.map((f) => (
                        <button key={f} type="button" className={'ab-chip' + ((data?.filter || filter) === f ? ' actief' : '')}
                            onClick={() => zetParam('filter', f)}>{FILTER_LABEL[f] || f}</button>
                    ))}
                </div>
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
                {item.jaar && <span className="ab-badge">{item.jaar}</span>}
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
                <div className="ab-cel"><Tekst label="Jaartal" type="number" waarde={item.jaar ?? ''} onSave={(w) => p({ jaar: w })} />{slot('jaar')}</div>
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
