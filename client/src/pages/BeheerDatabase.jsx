import React, { useCallback, useEffect, useRef, useState } from 'react';

// =====================================================================
// Database: één regel per titel. Alles wat je wilt weten op één lijn:
// titel + nummer, categorie, bekendheid, jaar, MP3, hints, vragen, NL.
// Bekendheid en categorie pas je direct in de regel aan.
// =====================================================================

async function api(pad, opties = {}) {
    const init = { credentials: 'include', ...opties };
    if (opties.body && typeof opties.body !== 'string') {
        init.body = JSON.stringify(opties.body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const r = await fetch(pad, init);
    let d = null;
    try { d = await r.json(); } catch { /* */ }
    if (!r.ok) throw new Error(d?.fout || 'Er ging iets mis.');
    return d;
}

export const CATS = [['film', 'Film'], ['serie', 'Serie'], ['anime', 'Anime'], ['game', 'Game'], ['muziek', 'Muziek'], ['kerst', 'Kerst'], ['sinterklaas', 'Sinterklaas'], ['kinder', 'Kinder']];
const TIERS = [['iconisch', 'Iconisch'], ['algemeen_bekend', 'Alg. bekend'], ['bekend', 'Bekend'], ['onbekend', 'Onbekend'], ['cult', 'Cult']];
const FILTERS = [['alle', 'Alles'], ['problemen', 'Problemen'], ['speelbaar', 'Speelbaar'], ['wacht', 'Wacht op jou'], ['uitgesloten', 'Uitgesloten']];
const DECENNIA = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

function jaar(item) {
    const j = item.muziek_jaar || item.jaar;
    if (!j) return '—';
    if (item.serie_lopend) return `${item.jaar}–`;
    if (item.eind_jaar && item.eind_jaar !== item.jaar) return `${item.jaar}–${String(item.eind_jaar).slice(2)}`;
    return String(j);
}

function Stip({ status, titel }) {
    return <i className={'db-stip ' + status} title={titel} aria-label={titel} />;
}

function Regel({ item, speel, speelt, onWijzig }) {
    const [bezig, setBezig] = useState(false);
    async function zet(veld, waarde) {
        setBezig(true);
        try { await api(`/api/admin/bank/items/${item.id}`, { method: 'PATCH', body: { [veld]: waarde } }); onWijzig(item.id, { [veld === 'categorie' ? 'categorie' : veld]: waarde }); }
        catch (e) { alert(e.message); }
        finally { setBezig(false); }
    }
    const mp3 = item.mp3_url ? (item.wacht_op_swipe ? 'wacht' : 'ok') : item.mp3_bezig ? 'bezig' : item.zoek_status === 'opgegeven' ? 'fout' : 'leeg';
    const mp3Titel = { ok: 'MP3 goedgekeurd', wacht: 'MP3 wacht op jouw goedkeuring', bezig: 'MP3 wordt gezocht', fout: 'MP3 niet gevonden', leeg: 'Nog geen MP3' }[mp3];
    const hints = (item.ai_hints || []).length;
    const vragen = item.vragen_aantal || 0;
    const nl = item.nl_bekend === 'ja' ? 'ok' : item.nl_bekend === 'nee' ? 'fout' : item.nl_bekend === 'twijfel' ? 'wacht' : 'leeg';
    const ai = item.ai_status === 'klaar' ? 'ok' : 'bezig';
    const nummer = [item.nummer_naam && item.nummer_naam !== item.naam ? item.nummer_naam : null, item.nummer_artiest].filter(Boolean).join(' — ');
    const vast = Array.isArray(item.handmatig) && item.handmatig.length > 0;
    return (
        <li className={'db-regel' + (bezig ? ' bezig' : '') + (item.curatie_status === 'uitgesloten' ? ' uit' : '')}>
            <button type="button" className={'db-speel' + (speelt ? ' aan' : '')} disabled={!item.mp3_url}
                onClick={() => speel(item)} aria-label={speelt ? 'Stop' : 'Afspelen'}>{speelt ? '■' : '▶'}</button>
            <span className="db-titel" title={[item.naam, nummer].filter(Boolean).join(' · ')}>
                <b>{item.naam}</b>{nummer && <small> · {nummer}</small>}{vast && <small title="Door jou aangepast; AI blijft eraf"> ·🔒</small>}
            </span>
            <select className="db-cat" value={item.categorie} onChange={(e) => zet('categorie', e.target.value)} aria-label="Categorie">
                {CATS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <select className={'db-tier tier-' + (item.bekendheid_tier || 'geen')} value={item.bekendheid_tier || ''}
                onChange={(e) => zet('bekendheid_tier', e.target.value || null)} aria-label="Bekendheid">
                <option value="" disabled>—</option>
                {TIERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <span className="db-jaar">{jaar(item)}</span>
            <span className="db-checks">
                <Stip status={mp3} titel={mp3Titel} />
                <span className={'db-getal' + (hints >= 3 ? ' ok' : '')} title={`${hints} hints`}>H{hints}</span>
                <span className={'db-getal' + (vragen >= 3 ? ' ok' : '')} title={`${vragen} bonusvragen`}>V{vragen}</span>
                <Stip status={nl} titel={`NL-bekend: ${item.nl_bekend || 'onbekend'}`} />
                <Stip status={ai} titel={ai === 'ok' ? 'AI klaar' : 'Nog bij AI'} />
            </span>
            <button type="button" className="db-uit" title={item.curatie_status === 'uitgesloten' ? 'Weer opnemen' : 'Uitsluiten'}
                onClick={() => zet('actief', item.curatie_status === 'uitgesloten')}>{item.curatie_status === 'uitgesloten' ? '↺' : '×'}</button>
        </li>
    );
}

export default function BeheerDatabase() {
    const [filter, setFilter] = useState('alle');
    const [cat, setCat] = useState('');
    const [tier, setTier] = useState('');
    const [decennium, setDecennium] = useState('');
    const [zoek, setZoek] = useState('');
    const [items, setItems] = useState([]);
    const [totaal, setTotaal] = useState(0);
    const [pagina, setPagina] = useState(1);
    const [fout, setFout] = useState('');
    const [speelt, setSpeelt] = useState(null);
    const audio = useRef(null);

    const laad = useCallback(async (p = 1) => {
        try {
            const q = new URLSearchParams({ tab: 'database', filter, pagina: String(p) });
            if (cat) q.set('categorie', cat);
            if (tier) q.set('tier', tier);
            if (decennium) q.set('decennium', decennium);
            if (zoek.trim()) q.set('zoek', zoek.trim());
            const d = await api(`/api/admin/bank/items?${q}`);
            setItems((oud) => (p === 1 ? d.items : [...oud, ...d.items]));
            setTotaal(d.totaal);
            setPagina(p);
            setFout('');
        } catch (e) { setFout(e.message); }
    }, [filter, cat, tier, decennium, zoek]);

    useEffect(() => {
        const t = setTimeout(() => laad(1), zoek ? 300 : 0);
        return () => clearTimeout(t);
    }, [laad, zoek]);

    useEffect(() => () => audio.current?.pause(), []);

    function speel(item) {
        if (!audio.current) audio.current = new Audio();
        if (speelt === item.id) { audio.current.pause(); setSpeelt(null); return; }
        audio.current.src = item.mp3_url;
        audio.current.play().then(() => setSpeelt(item.id)).catch(() => setSpeelt(null));
        audio.current.onended = () => setSpeelt(null);
    }

    return (
        <section className="db">
            <div className="db-filters">
                <input className="invoer db-zoek" type="search" placeholder="Zoek titel, nummer of artiest" value={zoek} onChange={(e) => setZoek(e.target.value)} />
                <select className="invoer" value={cat} onChange={(e) => { setCat(e.target.value); if (e.target.value !== 'muziek') setDecennium(''); }} aria-label="Categorie">
                    <option value="">Alle categorieën</option>
                    {CATS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
                {cat === 'muziek' && (
                    <select className="invoer" value={decennium} onChange={(e) => setDecennium(e.target.value)} aria-label="Decennium">
                        <option value="">Alle jaren</option>
                        {DECENNIA.map((d) => <option key={d} value={d}>Jaren {String(d).slice(2)}</option>)}
                    </select>
                )}
                <select className="invoer" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Bekendheid">
                    <option value="">Elke bekendheid</option>
                    {TIERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                    <option value="geen">Nog niet ingedeeld</option>
                </select>
            </div>
            <nav className="db-tabs">
                {FILTERS.map(([id, n]) => <button key={id} type="button" className={filter === id ? 'aan' : ''} onClick={() => setFilter(id)}>{n}</button>)}
                <span className="db-totaal">{totaal} titels</span>
            </nav>
            <div className="db-legenda" aria-hidden="true">
                <span><Stip status="ok" /> MP3 / NL / AI in orde</span><span><Stip status="wacht" /> wacht op jou</span>
                <span><Stip status="bezig" /> bezig</span><span><Stip status="fout" /> probleem</span><span>H = hints · V = vragen</span>
            </div>
            {fout && <p className="waarschuwing">{fout}</p>}
            <ul className="db-lijst">
                {items.map((item) => (
                    <Regel key={item.id} item={item} speel={speel} speelt={speelt === item.id}
                        onWijzig={(id, patch) => setItems((lijst) => lijst.map((x) => (x.id === id ? {
                            ...x, ...patch,
                            ...(patch.actief !== undefined ? { curatie_status: patch.actief ? 'goedgekeurd' : 'uitgesloten' } : {}),
                        } : x)))} />
                ))}
            </ul>
            {items.length < totaal && <button type="button" className="knop knop-stil db-meer" onClick={() => laad(pagina + 1)}>Meer laden ({totaal - items.length})</button>}
        </section>
    );
}

/** Voortgang naar de hoofddoelen: per categorie iconisch en algemeen bekend. */
export function Doelen({ status, onWijzig }) {
    const v = status?.voortgang;
    const inst = status?.instellingen;
    if (!v || !inst) return null;
    const doelen = inst.tierDoelen || { iconisch: 100, algemeen_bekend: 150 };
    async function patch(body) {
        await api('/api/admin/bank/instellingen', { method: 'PATCH', body }).catch((e) => alert(e.message));
        onWijzig?.();
    }
    const balk = (x) => {
        const pct = x.doel ? Math.min(100, Math.round((x.totaal / x.doel) * 100)) : 0;
        const speel = x.doel ? Math.min(100, Math.round((x.speelbaar / x.doel) * 100)) : 0;
        return (
            <span className="db-balk" title={`${x.totaal} gevonden, ${x.speelbaar} speelbaar, doel ${x.doel}`}>
                <i style={{ width: pct + '%' }} /><i className="speel" style={{ width: speel + '%' }} />
                <em>{x.totaal}/{x.doel}</em>
            </span>
        );
    };
    const rijen = [];
    for (const [c, naam] of CATS) {
        if (c === 'muziek') {
            for (const d of DECENNIA) rijen.push([`muziek-${d}`, `Muziek ${String(d).slice(2)}'`, v.muziek?.decennia?.[d]]);
        } else rijen.push([c, naam, v[c]]);
    }
    return (
        <section className="ab-kaart db-doelen">
            <div className="db-doelen-kop">
                <p className="ab-label">Doel per categorie</p>
                <label>Iconisch <input type="number" min="0" max="2000" defaultValue={doelen.iconisch}
                    onBlur={(e) => Number(e.target.value) !== doelen.iconisch && patch({ tierDoelen: { iconisch: Number(e.target.value) } })} /></label>
                <label>Alg. bekend <input type="number" min="0" max="2000" defaultValue={doelen.algemeen_bekend}
                    onBlur={(e) => Number(e.target.value) !== doelen.algemeen_bekend && patch({ tierDoelen: { algemeen_bekend: Number(e.target.value) } })} /></label>
                <label className="db-doorvullen"><input type="checkbox" checked={!!inst.doorvullen} onChange={(e) => patch({ doorvullen: e.target.checked })} /> Daarna doorgaan met minder bekend</label>
            </div>
            <div className="db-doelen-lijst">
                <span className="db-doelen-th" /><span className="db-doelen-th">Iconisch</span><span className="db-doelen-th">Algemeen bekend</span>
                {rijen.map(([id, naam, x]) => x && (
                    <React.Fragment key={id}>
                        <span className="db-doelen-naam">{naam}</span>
                        {balk(x.iconisch)}
                        {balk(x.algemeen_bekend)}
                    </React.Fragment>
                ))}
            </div>
            <p className="dim ab-mini">Lichte balk = gevonden door de AI, donkere balk = speelbaar (MP3 door jou goedgekeurd). Muziek wordt per decennium gevuld.</p>
        </section>
    );
}

/** Waar staan de MP3's (lokaal / NAS)? */
export function MediaStatus({ status }) {
    const m = status?.media;
    if (!m) return null;
    return (
        <section className={'ab-kaart db-media' + (m.beschikbaar ? '' : ' fout')}>
            <p className="ab-label">MP3-opslag</p>
            <p><b>{m.opNas ? 'NAS' : 'Lokaal'}</b> · {m.hostPad}
                {m.ruimte && <> · {m.ruimte.vrijGb} GB vrij van {m.ruimte.totaalGb} GB</>}</p>
            {!m.beschikbaar && <p className="ab-rood">NAS niet bereikbaar. Spelen gaat door vanaf de lokale reserve; downloads en de bestandscontrole wachten.</p>}
            {m.reserve?.beschikbaar && <p className="dim ab-mini">Lokale reserve aanwezig: wat niet op de NAS staat, speelt vanaf daar.</p>}
        </section>
    );
}
