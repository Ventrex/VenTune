import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './aanvragen.css';

// =====================================================================
// Iedereen met een account kan hier een film, serie, anime, game of nummer
// toevoegen. Zoeken gaat via TMDB (films/series/anime), IGDB (games) en
// iTunes/Discogs (muziek). Staat het er al in, dan zie je dat meteen.
// Niet gevonden? Typ de naam zelf en voeg hem toe.
// =====================================================================

const CATS = [
    ['film', '🎬 Film'], ['serie', '📺 Serie'], ['anime', '🌸 Anime'], ['game', '🎮 Videogame'],
    ['muziek', '🎵 Muziek'], ['kerst', '🎄 Kerst'], ['kinder', '🧸 Kinderlied'],
];
const MUZIEK = new Set(['muziek', 'kerst', 'kinder']);

async function json(r) { try { return await r.json(); } catch { return null; } }

export default function Aanvragen() {
    const [categorie, setCategorie] = useState('film');
    const [q, setQ] = useState('');
    const [items, setItems] = useState([]);
    const [zoeken, setZoeken] = useState(false);
    const [fout, setFout] = useState('');
    const [melding, setMelding] = useState('');
    const [recent, setRecent] = useState([]);
    const [artiest, setArtiest] = useState('');
    const [wie, setWie] = useState(null);
    const timer = useRef(null);

    useEffect(() => {
        fetch('/api/aanvragen/wie', { credentials: 'include' }).then(json).then((d) => setWie(d || { ingelogd: false })).catch(() => setWie({ ingelogd: false }));
    }, []);

    const laadRecent = () => fetch('/api/aanvragen/recent').then(json).then((d) => setRecent(d?.items || [])).catch(() => {});
    useEffect(() => { laadRecent(); }, []);

    useEffect(() => {
        clearTimeout(timer.current);
        setFout('');
        if (q.trim().length < 2 || !wie?.ingelogd) { setItems([]); return undefined; }
        timer.current = setTimeout(async () => {
            setZoeken(true);
            try {
                const r = await fetch(`/api/aanvragen/zoek?${new URLSearchParams({ categorie, q })}`, { credentials: 'include' });
                const d = await json(r);
                if (!r.ok) throw new Error(d?.fout || 'Zoeken mislukt.');
                setItems(d.items || []);
            } catch (e) { setFout(e.message); setItems([]); }
            finally { setZoeken(false); }
        }, 400);
        return () => clearTimeout(timer.current);
    }, [q, categorie, wie]);

    async function vraagAan(item) {
        setMelding('');
        const r = await fetch('/api/aanvragen', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categorie, ...item }),
        });
        const d = await json(r);
        setMelding(r.ok ? `${item.naam}: ${d.melding}` : (d?.fout || 'Aanvragen mislukt.'));
        if (r.ok) {
            setItems((lijst) => lijst.map((i) => (i === item ? { ...i, al_aanwezig: true, aanwezig: { tekst: d.status === 'bestaat' ? d.melding.replace(/\.$/, '') : 'Toegevoegd' } } : i)));
            laadRecent();
        }
    }

    if (wie && !wie.ingelogd) {
        return (
            <main className="scherm aanvraag-scherm">
                <Link className="terug" to="/">← Terug</Link>
                <h1>Zelf toevoegen</h1>
                <p>Mis je een film, serie, anime, game of nummer? Met een (gratis) account voeg je hem zelf toe. De AI controleert hem en zoekt de muziek erbij.</p>
                <Link className="knop" to="/host/login?return=/aanvragen">Inloggen of registreren</Link>
            </main>
        );
    }

    return (
        <main className="scherm aanvraag-scherm">
            <Link className="terug" to="/">← Terug</Link>
            <h1>Zelf toevoegen</h1>
            <p className="dim">Mis je een film, serie, anime, game of nummer? Zoek hem op en voeg hem toe{wie?.naam ? `, ${wie.naam}` : ''}. Staat hij er al in, dan zie je dat meteen. De AI controleert hem en zoekt de muziek erbij.</p>

            <div className="aanvraag-cats">
                {CATS.map(([id, naam]) => (
                    <button key={id} type="button" className={'chip' + (categorie === id ? ' gekozen' : '')}
                        onClick={() => { setCategorie(id); setItems([]); }}>{naam}</button>
                ))}
            </div>
            <input className="invoer" placeholder={MUZIEK.has(categorie) ? 'Zoek nummer of artiest…' : 'Zoek op naam…'} value={q}
                onChange={(e) => setQ(e.target.value)} autoFocus />
            {melding && <p className="aanvraag-melding">{melding}</p>}
            {fout && <p className="waarschuwing">{fout}</p>}
            {zoeken && <p className="dim">Zoeken…</p>}

            <ul className="aanvraag-lijst">
                {items.map((item, i) => (
                    <li key={`${item.extern_id || item.naam}-${i}`}>
                        {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span className="aanvraag-leeg">{MUZIEK.has(categorie) ? '♪' : '?'}</span>}
                        <div>
                            <strong>{item.naam}</strong>
                            <span className="dim">{[item.artiest, item.jaar].filter(Boolean).join(' · ')}</span>
                            {item.omschrijving && <small className="dim">{item.omschrijving}</small>}
                            {item.genres?.length > 0 && <small className="aanvraag-genres">{item.genres.join(' · ')}</small>}
                        </div>
                        {item.al_aanwezig
                            ? <span className={'aanvraag-al ' + (item.aanwezig?.status || '')}>✓ {item.aanwezig?.tekst || 'Staat er al in'}</span>
                            : <button type="button" className="knop" onClick={() => vraagAan(item)}>Toevoegen</button>}
                    </li>
                ))}
            </ul>

            {q.trim().length >= 2 && !zoeken && (
                <div className="kaart aanvraag-zelf">
                    <p><strong>Niet gevonden?</strong> Voeg "{q.trim()}" zo toe.</p>
                    {MUZIEK.has(categorie) && <input className="invoer" placeholder="Artiest" value={artiest} onChange={(e) => setArtiest(e.target.value)} />}
                    <button type="button" className="knop knop-stil" onClick={() => vraagAan({ naam: q.trim(), artiest, bron: 'handmatig' })}>"{q.trim()}" toevoegen</button>
                </div>
            )}

            {recent.length > 0 && (
                <section className="aanvraag-recent">
                    <h2>Laatst toegevoegd</h2>
                    <ul>
                        {recent.map((r) => (
                            <li key={r.id}>
                                <span><strong>{r.naam}</strong> <span className="dim">· {CATS.find((c) => c[0] === r.categorie)?.[1] || r.categorie} · {r.door}</span></span>
                                <span className="aanvraag-status">{r.status}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </main>
    );
}
