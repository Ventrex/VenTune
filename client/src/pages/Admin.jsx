import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import { haalVideoId } from '../lib/youtube.js';

// Beheerportaal (/admin). Wachtwoord uit ADMIN_PASSWORD op de server.
export default function Admin() {
    const [ingelogd, setIngelogd] = useState(null); // null=laden

    useEffect(() => {
        api.adminSessie().then((s) => setIngelogd(s.ingelogd));
    }, []);

    if (ingelogd === null) return <main className="scherm"><p className="dim">Laden…</p></main>;
    if (!ingelogd) return <Login onIn={() => setIngelogd(true)} />;
    return <Beheer onUit={() => setIngelogd(false)} />;
}

function Login({ onIn }) {
    const [ww, setWw] = useState('');
    const [fout, setFout] = useState('');
    async function verstuur(e) {
        e.preventDefault();
        try {
            await api.adminLogin(ww);
            onIn();
        } catch (err) {
            setFout(err.message);
        }
    }
    return (
        <main className="scherm">
            <h1>Beheer</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            <form onSubmit={verstuur} className="stapel">
                <input
                    className="invoer"
                    type="password"
                    value={ww}
                    onChange={(e) => setWw(e.target.value)}
                    placeholder="Wachtwoord"
                    aria-label="Wachtwoord"
                    autoFocus
                />
                <button className="knop" type="submit">Inloggen</button>
            </form>
            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/">← Terug</Link>
            </p>
        </main>
    );
}

function Beheer({ onUit }) {
    const [titels, setTitels] = useState([]);
    const [zoek, setZoek] = useState('');
    const [melding, setMelding] = useState('');
    const [bezigSeed, setBezigSeed] = useState(false);
    const [open, setOpen] = useState(null); // uitgeklapte titel-id

    async function laad() {
        try {
            setTitels(await api.adminTitels(zoek));
        } catch (err) {
            setMelding(err.message);
        }
    }
    useEffect(() => { laad(); /* eslint-disable-next-line */ }, []);

    async function seed() {
        setBezigSeed(true);
        setMelding('Seed importeren… dit kan even duren.');
        try {
            const s = await api.adminSeed(false);
            setMelding(
                `Seed klaar: ${s.metTrack}/${s.verwerkt} titels met track.` +
                (s.zonder.length ? ` Zonder clip: ${s.zonder.join(', ')}.` : ''),
            );
            laad();
        } catch (err) {
            setMelding('Seed mislukt: ' + err.message);
        } finally {
            setBezigSeed(false);
        }
    }

    async function uitloggen() {
        await api.adminLogout();
        onUit();
    }

    return (
        <main className="scherm host-scherm">
            <div className="raden-kop">
                <h1 style={{ margin: 0 }}>Beheer</h1>
                <button className="terug als-link" onClick={uitloggen}>Uitloggen</button>
            </div>

            {melding && <p className="waarschuwing">{melding}</p>}

            <div className="stapel" style={{ marginTop: '1rem' }}>
                <button className="knop knop-stil" onClick={seed} disabled={bezigSeed}>
                    {bezigSeed ? 'Bezig…' : 'Startseed importeren (iTunes)'}
                </button>
            </div>

            <form
                className="zoekbalk"
                style={{ marginTop: '1.5rem' }}
                onSubmit={(e) => { e.preventDefault(); laad(); }}
            >
                <input
                    className="invoer"
                    value={zoek}
                    onChange={(e) => setZoek(e.target.value)}
                    placeholder="Zoek titel…"
                />
                <button className="knop" type="submit">Zoek</button>
            </form>

            <NieuweTitel onKlaar={laad} />

            <p className="kaart-label" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
                Titels ({titels.length})
            </p>
            <ul className="spelerlijst">
                {titels.map((t) => (
                    <li key={t.id} className="titel-blok">
                        <div
                            className="titel-rij"
                            onClick={() => setOpen(open === t.id ? null : t.id)}
                        >
                            <span className="speler-naam">
                                {t.naam}
                                <span className="dim"> · {t.type} · {t.taal} · {t.jaar || '—'}</span>
                            </span>
                            <span className={'track-badge' + (t.aantal_tracks ? '' : ' leeg')}>
                                {t.aantal_tracks} ♪
                            </span>
                        </div>
                        {open === t.id && (
                            <TitelDetail titel={t} onWijzig={laad} />
                        )}
                    </li>
                ))}
            </ul>

            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/">← Terug naar start</Link>
            </p>
        </main>
    );
}

const LEEG = { naam: '', type: 'film', taal: 'nl', jaar: '', land: '', aliassen: '', genres: '', tmdb_id: '' };

function NieuweTitel({ onKlaar }) {
    const [uit, setUit] = useState(false);
    const [f, setF] = useState(LEEG);
    const [fout, setFout] = useState('');

    async function opslaan(e) {
        e.preventDefault();
        try {
            await api.adminMaakTitel(naarPayload(f));
            setF(LEEG);
            setUit(false);
            onKlaar();
        } catch (err) {
            setFout(err.message);
        }
    }

    if (!uit) {
        return (
            <button className="knop knop-stil" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setUit(true)}>
                + Nieuwe titel
            </button>
        );
    }
    return (
        <form className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }} onSubmit={opslaan}>
            {fout && <p className="waarschuwing">{fout}</p>}
            <TitelVelden f={f} setF={setF} />
            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                <button className="knop" type="submit">Toevoegen</button>
                <button className="knop knop-stil" type="button" onClick={() => setUit(false)}>Annuleer</button>
            </div>
        </form>
    );
}

function TitelDetail({ titel, onWijzig }) {
    const [f, setF] = useState(naarForm(titel));
    const [tracks, setTracks] = useState([]);
    const [melding, setMelding] = useState('');

    async function laadTracks() {
        setTracks(await api.adminTracks(titel.id));
    }
    useEffect(() => { laadTracks(); /* eslint-disable-next-line */ }, [titel.id]);

    async function bewaar() {
        try {
            await api.adminUpdateTitel(titel.id, naarPayload(f));
            setMelding('Opgeslagen.');
            onWijzig();
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function verwijder() {
        if (!confirm(`Titel "${titel.naam}" verwijderen?`)) return;
        await api.adminVerwijderTitel(titel.id);
        onWijzig();
    }
    async function verwijderTrack(id) {
        await api.adminVerwijderTrack(id);
        laadTracks();
        onWijzig();
    }

    return (
        <div className="titel-detail">
            {melding && <p className="dim">{melding}</p>}
            <TitelVelden f={f} setF={setF} />
            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                <button className="knop" onClick={bewaar}>Opslaan</button>
                <button className="knop knop-stil" onClick={verwijder}>Verwijder titel</button>
            </div>

            <p className="kaart-label" style={{ marginTop: '1rem' }}>Tracks</p>
            <ul className="tracklijst">
                {tracks.map((tr) => (
                    <li key={tr.id} className="track">
                        <div className="track-info">
                            <span className="track-naam">{tr.tracknaam}</span>
                            <span className="dim">{tr.artiest} · {tr.bron}</span>
                        </div>
                        <audio src={tr.preview_url} controls preload="none" style={{ height: 36, maxWidth: 160 }} />
                        <button className="afspeelknop klein" onClick={() => verwijderTrack(tr.id)} aria-label="Verwijderen">✕</button>
                    </li>
                ))}
                {tracks.length === 0 && <li className="dim">Nog geen tracks.</li>}
            </ul>

            <TrackZoeker titelId={titel.id} onToegevoegd={() => { laadTracks(); onWijzig(); }} />
            <YoutubeToevoegen titelId={titel.id} onToegevoegd={() => { laadTracks(); onWijzig(); }} />
        </div>
    );
}

// Voeg een YouTube-track toe (voor titels die iTunes mist).
function YoutubeToevoegen({ titelId, onToegevoegd }) {
    const [url, setUrl] = useState('');
    const [naam, setNaam] = useState('');
    const [start, setStart] = useState('');
    const [fout, setFout] = useState('');

    async function toevoegen(e) {
        e.preventDefault();
        const id = haalVideoId(url);
        if (!id) { setFout('Geen geldige YouTube-link.'); return; }
        try {
            await api.adminVoegTrack(titelId, {
                bron: 'youtube',
                preview_url: id,
                start_seconde: start ? Number(start) : 0,
                tracknaam: naam.trim() || 'YouTube',
                artiest: 'YouTube',
            });
            setUrl(''); setNaam(''); setStart(''); setFout('');
            onToegevoegd();
        } catch (err) {
            setFout(err.message);
        }
    }

    return (
        <form onSubmit={toevoegen} style={{ marginTop: '0.75rem' }}>
            <p className="kaart-label">YouTube-link toevoegen</p>
            {fout && <p className="waarschuwing">{fout}</p>}
            <div className="velden">
                <input className="invoer" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube-URL of video-id" />
                <div className="zoekbalk">
                    <input className="invoer" value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam (bv. Titelsong)" />
                    <input className="invoer" value={start} onChange={(e) => setStart(e.target.value)} placeholder="Start (sec)" style={{ maxWidth: 110 }} />
                </div>
                <button className="knop knop-stil" type="submit">YouTube-track toevoegen</button>
            </div>
        </form>
    );
}

// Zoek op iTunes en voeg een track toe.
function TrackZoeker({ titelId, onToegevoegd }) {
    const [term, setTerm] = useState('');
    const [res, setRes] = useState([]);
    const [bezig, setBezig] = useState(false);
    const audioRef = useRef(null);

    async function zoek(e) {
        e.preventDefault();
        setBezig(true);
        try {
            const d = await api.zoekMuziek(term);
            setRes(d.resultaten);
        } catch { setRes([]); } finally { setBezig(false); }
    }
    async function voegToe(r) {
        await api.adminVoegTrack(titelId, {
            bron: 'itunes',
            itunes_track_id: r.itunes_track_id,
            preview_url: r.preview_url,
            tracknaam: r.tracknaam,
            artiest: r.artiest,
        });
        setRes([]);
        setTerm('');
        onToegevoegd();
    }

    return (
        <div style={{ marginTop: '0.75rem' }}>
            <form className="zoekbalk" onSubmit={zoek}>
                <input className="invoer" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Zoek clip op iTunes…" />
                <button className="knop knop-stil" type="submit" disabled={bezig}>{bezig ? '…' : 'Zoek'}</button>
            </form>
            {res.length > 0 && (
                <ul className="tracklijst" style={{ marginTop: '0.5rem' }}>
                    {res.map((r) => (
                        <li key={r.itunes_track_id} className="track">
                            <div className="track-info">
                                <span className="track-naam">{r.tracknaam}</span>
                                <span className="dim">{r.artiest}</span>
                            </div>
                            <button className="afspeelknop klein" onClick={() => {
                                if (audioRef.current) { audioRef.current.src = r.preview_url; audioRef.current.play(); }
                            }} aria-label="Beluister">▶</button>
                            <button className="knop knop-stil" onClick={() => voegToe(r)}>+</button>
                        </li>
                    ))}
                </ul>
            )}
            <audio ref={audioRef} preload="none" />
        </div>
    );
}

function TitelVelden({ f, setF }) {
    const zet = (k) => (e) => setF({ ...f, [k]: e.target.value });
    return (
        <div className="velden">
            <input className="invoer" value={f.naam} onChange={zet('naam')} placeholder="Naam" />
            <div className="zoekbalk">
                <select className="invoer" value={f.type} onChange={zet('type')}>
                    <option value="film">film</option>
                    <option value="serie">serie</option>
                </select>
                <select className="invoer" value={f.taal} onChange={zet('taal')}>
                    <option value="nl">nl</option>
                    <option value="en">en</option>
                </select>
                <input className="invoer" value={f.jaar} onChange={zet('jaar')} placeholder="Jaar" style={{ maxWidth: 90 }} />
            </div>
            <input className="invoer" value={f.land} onChange={zet('land')} placeholder="Land" />
            <input className="invoer" value={f.aliassen} onChange={zet('aliassen')} placeholder="Aliassen (komma-gescheiden)" />
            <input className="invoer" value={f.genres} onChange={zet('genres')} placeholder="Genres (komma-gescheiden)" />
            <input className="invoer" value={f.tmdb_id} onChange={zet('tmdb_id')} placeholder="TMDB-id (optioneel, voor bonus)" />
        </div>
    );
}

// --- Hulp: form <-> payload ---
function naarForm(t) {
    return {
        naam: t.naam || '',
        type: t.type || 'film',
        taal: t.taal || 'nl',
        jaar: t.jaar || '',
        land: t.land || '',
        aliassen: (t.aliassen || []).join(', '),
        genres: (t.genres || []).join(', '),
        tmdb_id: t.tmdb_id || '',
    };
}
function naarPayload(f) {
    const lijst = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    return {
        naam: f.naam.trim(),
        type: f.type,
        taal: f.taal,
        jaar: f.jaar ? Number(f.jaar) : null,
        land: f.land.trim() || null,
        aliassen: lijst(f.aliassen),
        genres: lijst(f.genres),
        tmdb_id: f.tmdb_id ? Number(f.tmdb_id) : null,
    };
}
