import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import HostPlayer from '../components/HostPlayer.jsx';
import Timer from '../components/Timer.jsx';

// Host-scherm (het grote scherm). Speelt de muziek af en toont de QR,
// de visualizer, de timer en het scorebord.
export default function Host() {
    const navigate = useNavigate();
    const spel = useSpel();
    const { sessie, fase, ronde, antwoord, bonus, scorebord, spelers, audio } = spel;
    const spelerRef = useRef(null);

    // Ontgrendel de speler tijdens de tik op 'Start spel', zodat ook latere
    // rondes vanzelf geluid geven (iOS staat afspelen alleen toe na een tik).
    async function startMetGeluid() {
        if (spelerRef.current) await spelerRef.current.ontgrendel();
        spel.startSpel();
    }

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);
    if (!sessie) return null;

    const joinUrl = `${window.location.origin}/join/${sessie.code}`;

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    return (
        <main className="scherm host-scherm">
            {spel.fout && <p className="waarschuwing">{spel.fout}</p>}

            {/* Wachtruimte — in landscape: spelers links, QR rechts */}
            {fase === 'wachten' && (
                <>
                    <h1>Lobby</h1>
                    <div className="host-wacht">
                        <div className="host-wacht-links">
                            <p className="kaart-label" style={{ textAlign: 'left' }}>
                                Spelers ({spelers.length})
                            </p>
                            <ul className="spelerlijst">
                                {spelers.map((s) => (
                                    <li
                                        key={s.id}
                                        className={
                                            'speler-kaart' + (s.verbonden ? '' : ' weg')
                                        }
                                    >
                                        <span className="speler-naam">
                                            {s.naam}
                                            {s.is_host && (
                                                <span className="host-tag">host</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                                {spelers.length === 0 && (
                                    <li className="dim">Nog niemand — scan de QR →</li>
                                )}
                            </ul>
                            <div className="stapel" style={{ marginTop: '1.5rem' }}>
                                <button
                                    className="knop"
                                    onClick={startMetGeluid}
                                    disabled={spelers.length < 1}
                                >
                                    Start spel
                                </button>
                            </div>
                        </div>

                        <div className="kaart host-kaart host-wacht-rechts">
                            <p className="kaart-label">Scan om mee te doen</p>
                            <p className="lobby-code">{sessie.code}</p>
                            <div className="qr-doos">
                                <QRCodeSVG
                                    value={joinUrl}
                                    size={200}
                                    bgColor="#000000"
                                    fgColor="#f5f5f5"
                                    level="M"
                                    includeMargin
                                />
                            </div>
                            <p className="dim" style={{ wordBreak: 'break-all' }}>
                                {joinUrl}
                            </p>
                        </div>
                    </div>
                </>
            )}

            {/* Ronde bezig */}
            {fase === 'raden' && ronde && (
                <>
                    <p className="ronde-teller">
                        Ronde {ronde.rondenummer} / {ronde.totaal}
                    </p>
                    {/* In kennersmodus telt er niets af. */}
                    {ronde.durationMs ? (
                        <div className="timer-groot">
                            <Timer
                                startTs={ronde.startTs}
                                durationMs={ronde.durationMs}
                            />
                        </div>
                    ) : (
                        <p className="ronde-teller">Kennersmodus — raad maar raak</p>
                    )}
                    <HostPlayer ref={spelerRef} audio={audio} />
                    <div className="host-knoppen">
                        <button className="knop knop-stil" onClick={spel.herhaal}>
                            ↻ Opnieuw afspelen
                        </button>
                        <button className="knop" onClick={spel.volgende}>
                            Volgende →
                        </button>
                    </div>
                    <p className="dim" style={{ marginTop: '1rem' }}>
                        Raad de titel op je telefoon…
                    </p>
                    <Scorebord lijst={scorebord} compact />
                </>
            )}

            {/* Titel onthuld */}
            {fase === 'onthul' && antwoord && (
                <>
                    <p className="kaart-label">Het antwoord was</p>
                    <h1>{antwoord.naam}</h1>
                    <AntwoordInfo antwoord={antwoord} />
                    <div className="host-knoppen">
                        <button className="knop" onClick={spel.volgende}>
                            Volgende →
                        </button>
                    </div>
                </>
            )}

            {/* Bonusvraag (host toont de vraag mee) */}
            {fase === 'bonus' && bonus && (
                <>
                    {antwoord && <h1>{antwoord.naam}</h1>}
                    <p className="kaart-label">Bonusvraag</p>
                    <p className="ondertitel">{bonus.vraag}</p>
                    <ul className="spelerlijst">
                        {bonus.opties.map((o, i) => (
                            <li key={i} className="speler-kaart">
                                <span className="speler-naam">{o}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="dim" style={{ marginTop: '1rem' }}>
                        Spelers antwoorden op hun telefoon…
                    </p>
                </>
            )}

            {/* Tussen rondes */}
            {fase === 'scorebord' && (
                <>
                    {antwoord && (
                        <>
                            <p className="kaart-label">Vorige titel</p>
                            <h1>{antwoord.naam}</h1>
                            <AntwoordInfo antwoord={antwoord} />
                        </>
                    )}
                    <Scorebord lijst={scorebord} />
                    <div className="host-knoppen">
                        <button className="knop" onClick={spel.volgende}>
                            Volgende →
                        </button>
                    </div>
                </>
            )}

            {/* Einde */}
            {fase === 'einde' && (
                <>
                    <h1>Eindstand</h1>
                    <Scorebord lijst={scorebord} eind />
                    <div className="stapel" style={{ marginTop: '1.5rem' }}>
                        <button className="knop" onClick={verlaten}>
                            Nieuw spel
                        </button>
                    </div>
                </>
            )}
        </main>
    );
}

// Toont alle informatie over de titel: type, jaar, taal, land en genres.
export function AntwoordInfo({ antwoord }) {
    if (!antwoord) return null;
    const type = antwoord.type === 'serie' ? 'Serie' : 'Film';
    const taal = antwoord.taal === 'nl' ? 'Nederlands' : 'Internationaal';
    return (
        <>
            <div className="info-rij">
                <span className="info-chip">{type}</span>
                {antwoord.jaar && <span className="info-chip">{antwoord.jaar}</span>}
                <span className="info-chip">{taal}</span>
                {antwoord.land && <span className="info-chip">{antwoord.land}</span>}
                {(antwoord.genres || []).map((g) => (
                    <span key={g} className="info-chip">{g}</span>
                ))}
            </div>
            <p className="dim">
                {antwoord.tracknaam}
                {antwoord.artiest ? ` — ${antwoord.artiest}` : ''}
            </p>
        </>
    );
}

function Scorebord({ lijst, compact, eind }) {
    if (!lijst || lijst.length === 0) return null;
    return (
        <ul className="scorebord" style={{ marginTop: compact ? '1.5rem' : '1rem' }}>
            {lijst.map((s, i) => (
                <li
                    key={s.id}
                    className={'score-rij' + (eind && i === 0 ? ' winnaar' : '')}
                >
                    <span className="score-plek">{i + 1}</span>
                    <span className="score-naam">{s.naam}</span>
                    <span className="score-punten">{s.score}</span>
                </li>
            ))}
        </ul>
    );
}
