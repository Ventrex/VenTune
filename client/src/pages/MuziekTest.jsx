import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { zoekMuziek } from '../lib/api.js';

// Muziek-testpagina (/muziek).
//
// Het bewijs dat er geluid uit je telefoon komt (zonder Spotify, zonder
// login, zonder Premium) én je coverage-check: typ een titel — vooral
// Nederlandse — en zie of iTunes bruikbare clips heeft.
export default function MuziekTest() {
    const [term, setTerm] = useState('');
    const [bezig, setBezig] = useState(false);
    const [fout, setFout] = useState('');
    const [resultaten, setResultaten] = useState(null);
    const [spelendId, setSpelendId] = useState(null);
    const audioRef = useRef(null);

    // Snelknoppen om Nederlandse dekking snel te testen.
    const voorbeelden = [
        'Undercover',
        'Penoza',
        'Gooische Vrouwen',
        'Flodder',
        'Zwartboek',
        'Stranger Things',
    ];

    async function zoeken(zoekterm) {
        const t = (zoekterm ?? term).trim();
        if (!t) return;
        setTerm(t);
        setBezig(true);
        setFout('');
        setResultaten(null);
        stop();
        try {
            const data = await zoekMuziek(t);
            setResultaten(data);
        } catch (err) {
            setFout(err.message);
        } finally {
            setBezig(false);
        }
    }

    function speel(track) {
        if (!audioRef.current) return;
        if (spelendId === track.itunes_track_id) {
            stop();
            return;
        }
        audioRef.current.src = track.preview_url;
        audioRef.current.play().catch(() => setFout('Kon deze clip niet afspelen.'));
        setSpelendId(track.itunes_track_id);
    }

    function stop() {
        if (audioRef.current) {
            audioRef.current.pause();
        }
        setSpelendId(null);
    }

    return (
        <main className="scherm">
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <Link className="terug" to="/">
                    ← Terug
                </Link>
            </p>
            <h1>Muziek zoeken</h1>
            <p className="ondertitel">Test de dekking en speel fragmenten af</p>

            <div className="kaart" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
                <p className="kaart-label">Muziek zoeken (test)</p>
                <p className="dim" style={{ marginTop: 0 }}>
                    Typ een filmtitel of serie en speel een fragment af. Zo test je
                    of iTunes genoeg biedt — vooral voor Nederlandse titels.
                </p>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        zoeken();
                    }}
                    className="zoekbalk"
                >
                    <input
                        className="invoer"
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        placeholder="bv. Undercover"
                        aria-label="Zoekterm"
                    />
                    <button className="knop" type="submit" disabled={bezig}>
                        {bezig ? 'Zoeken…' : 'Zoek'}
                    </button>
                </form>

                <div className="chips">
                    {voorbeelden.map((v) => (
                        <button key={v} className="chip" onClick={() => zoeken(v)}>
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {fout && <p className="waarschuwing">{fout}</p>}

            {resultaten && (
                <p className="dim" style={{ textAlign: 'left' }}>
                    {resultaten.aantal} bruikbare clip
                    {resultaten.aantal === 1 ? '' : 's'} voor “{resultaten.term}”.
                </p>
            )}

            {resultaten && resultaten.resultaten.length > 0 && (
                <ul className="tracklijst">
                    {resultaten.resultaten.map((track) => (
                        <li key={track.itunes_track_id} className="track">
                            {track.hoes && (
                                <img className="track-hoes" src={track.hoes} alt="" />
                            )}
                            <div className="track-info">
                                <span className="track-naam">{track.tracknaam}</span>
                                <span className="dim">{track.artiest}</span>
                            </div>
                            <button
                                className={
                                    spelendId === track.itunes_track_id
                                        ? 'afspeelknop bezig'
                                        : 'afspeelknop'
                                }
                                onClick={() => speel(track)}
                                aria-label={
                                    spelendId === track.itunes_track_id
                                        ? 'Stop'
                                        : 'Afspelen'
                                }
                            >
                                {spelendId === track.itunes_track_id ? '■' : '▶'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {/* Eén gedeeld audio-element voor alle previews. */}
            <audio ref={audioRef} onEnded={stop} preload="none" />
        </main>
    );
}
