import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import Visualizer from '../components/Visualizer.jsx';
import Timer from '../components/Timer.jsx';

// Spelerscherm (telefoon). Geen audio, geen titel — alleen de visualizer
// en het raadveld. Feedback komt van de server.
export default function Play() {
    const navigate = useNavigate();
    const spel = useSpel();
    const { sessie, fase, ronde, resultaat, hints, antwoord, scorebord, spelers } =
        spel;
    const [gok, setGok] = useState('');

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);

    // Bij een nieuwe ronde het invoerveld leegmaken.
    useEffect(() => {
        setGok('');
    }, [ronde?.rondeId]);

    if (!sessie) return null;

    const goedGeraden = resultaat?.status === 'goed';

    function versturen(e) {
        e.preventDefault();
        if (!gok.trim() || goedGeraden) return;
        spel.gok(gok.trim());
    }

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    return (
        <main className="scherm">
            {spel.fout && <p className="waarschuwing">{spel.fout}</p>}

            {/* Wachtruimte */}
            {fase === 'wachten' && (
                <>
                    <h1>Klaar om te spelen</h1>
                    <p className="ondertitel">
                        Lobby <span className="code-inline">{sessie.code}</span> —
                        wachten op de host…
                    </p>
                    <ul className="spelerlijst">
                        {spelers.map((s) => (
                            <li
                                key={s.id}
                                className={
                                    'speler-kaart' +
                                    (s.id === sessie.spelerId ? ' actief' : '') +
                                    (s.verbonden ? '' : ' weg')
                                }
                            >
                                <span className="speler-naam">
                                    {s.naam}
                                    {s.is_host && <span className="host-tag">host</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p style={{ marginTop: '2rem' }}>
                        <button className="terug als-link" onClick={verlaten}>
                            Lobby verlaten
                        </button>
                    </p>
                </>
            )}

            {/* Raden */}
            {fase === 'raden' && ronde && (
                <>
                    <div className="raden-kop">
                        <span className="dim">
                            Ronde {ronde.rondenummer} / {ronde.totaal}
                        </span>
                        <Timer startTs={ronde.startTs} durationMs={ronde.durationMs} />
                    </div>
                    <Visualizer actief />

                    {goedGeraden ? (
                        <div className="kaart" style={{ marginTop: '1.5rem' }}>
                            <p className="goed-tekst">Goed! +{resultaat.punten}</p>
                            <p className="dim">Wachten op de anderen…</p>
                        </div>
                    ) : (
                        <>
                            <form
                                onSubmit={versturen}
                                className="zoekbalk"
                                style={{ marginTop: '1.5rem' }}
                            >
                                <input
                                    className="invoer"
                                    value={gok}
                                    onChange={(e) => setGok(e.target.value)}
                                    placeholder="Titel raden…"
                                    aria-label="Jouw titel"
                                    autoFocus
                                />
                                <button className="knop" type="submit">
                                    Raad
                                </button>
                            </form>

                            <button
                                className="knop knop-stil"
                                style={{ marginTop: '0.75rem', width: '100%' }}
                                onClick={spel.vraagHint}
                            >
                                Hint (−25)
                            </button>

                            {resultaat && !goedGeraden && (
                                <p
                                    className={
                                        'feedback ' +
                                        (resultaat.status === 'bijna'
                                            ? 'bijna'
                                            : resultaat.status === 'fout'
                                              ? 'mis'
                                              : 'neutraal')
                                    }
                                >
                                    {resultaat.status === 'bijna' &&
                                        'Bijna! Probeer nog eens.'}
                                    {resultaat.status === 'fout' && 'Helaas, mis.'}
                                    {resultaat.status === 'tempo' && resultaat.melding}
                                    {resultaat.status === 'hint-fout' &&
                                        resultaat.melding}
                                </p>
                            )}
                        </>
                    )}

                    {hints.length > 0 && (
                        <ul className="hintlijst">
                            {hints.map((h, i) => (
                                <li key={i} className="hint-rij">
                                    {h.tekst}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            {/* Tussen rondes */}
            {fase === 'scorebord' && antwoord && (
                <>
                    <p className="kaart-label">Het antwoord was</p>
                    <h1>{antwoord.naam}</h1>
                    <p className="ondertitel">
                        {antwoord.jaar ? `${antwoord.jaar} · ` : ''}
                        {antwoord.tracknaam} — {antwoord.artiest}
                    </p>
                    <MiniScore lijst={scorebord} mijnId={sessie.spelerId} />
                </>
            )}

            {/* Einde */}
            {fase === 'einde' && (
                <>
                    <h1>Eindstand</h1>
                    <MiniScore lijst={scorebord} mijnId={sessie.spelerId} eind />
                    <div className="stapel" style={{ marginTop: '1.5rem' }}>
                        <button className="knop" onClick={verlaten}>
                            Terug naar start
                        </button>
                    </div>
                </>
            )}
        </main>
    );
}

function MiniScore({ lijst, mijnId, eind }) {
    if (!lijst || lijst.length === 0) return null;
    return (
        <ul className="scorebord" style={{ marginTop: '1rem' }}>
            {lijst.map((s, i) => (
                <li
                    key={s.id}
                    className={
                        'score-rij' +
                        (s.id === mijnId ? ' actief' : '') +
                        (eind && i === 0 ? ' winnaar' : '')
                    }
                >
                    <span className="score-plek">{i + 1}</span>
                    <span className="score-naam">{s.naam}</span>
                    <span className="score-punten">{s.score}</span>
                </li>
            ))}
        </ul>
    );
}
