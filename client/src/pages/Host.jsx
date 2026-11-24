import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useSpel } from '../lib/useSpel.js';
import HostPlayer from '../components/HostPlayer.jsx';
import Speelbord from '../components/Speelbord.jsx';

// Host-scherm. De host speelt de muziek af (of stuurt die door naar het
// tv-scherm), bedient het spel en speelt zelf mee in hetzelfde
// Kahoot-scherm als de spelers.

const GELUID_SLEUTEL = 'vt_geluid_via_tv';

function HostBalk({ spel, geluidViaTv, onGeluid, tvUrl }) {
    const { fase, lobbyInstellingen } = spel;
    const hintsAan = lobbyInstellingen?.hints_aan !== false;
    const vragenAan = lobbyInstellingen?.bonusvragen_aan !== false;
    return (
        <nav className="kz-hostbalk" aria-label="Spel bedienen">
            {fase === 'raden' && (
                <button type="button" className={'kz-hb' + (spel.gepauzeerd ? ' aan' : '')}
                    onClick={spel.gepauzeerd ? spel.hervat : spel.pauzeer}>
                    <b>{spel.gepauzeerd ? '▶' : '❚❚'}</b><span>{spel.gepauzeerd ? 'Verder' : 'Pauze'}</span>
                </button>
            )}
            {fase === 'raden' && (
                <button type="button" className="kz-hb" onClick={spel.herhaal}><b>↺</b><span>Opnieuw</span></button>
            )}
            <button type="button" className={'kz-hb' + (hintsAan ? ' aan' : '')} aria-pressed={hintsAan}
                onClick={() => spel.schakel({ hints: !hintsAan })}><b>?</b><span>Hints {hintsAan ? 'aan' : 'uit'}</span></button>
            <button type="button" className={'kz-hb' + (vragenAan ? ' aan' : '')} aria-pressed={vragenAan}
                onClick={() => spel.schakel({ vragen: !vragenAan })}><b>+</b><span>Bonus {vragenAan ? 'aan' : 'uit'}</span></button>
            <button type="button" className={'kz-hb' + (geluidViaTv ? ' aan' : '')} aria-pressed={geluidViaTv}
                onClick={() => onGeluid(!geluidViaTv)} title={tvUrl}><b>{geluidViaTv ? '▭' : '♪'}</b><span>{geluidViaTv ? 'Geluid tv' : 'Geluid hier'}</span></button>
            {fase !== 'einde' && (
                <button type="button" className="kz-hb kz-hb-volgende" onClick={spel.volgende}>
                    <b>→</b><span>{fase === 'raden' ? 'Stop ronde' : 'Volgende'}</span>
                </button>
            )}
        </nav>
    );
}

function Keuze({ label, opties, waarde, onKies }) {
    return (
        <div className="kz-instelling">
            <span className="kz-label">{label}</span>
            <div className="kz-segment">
                {opties.map(([w, tekst]) => (
                    <button key={String(w)} type="button" className={waarde === w ? 'aan' : ''} onClick={() => onKies(w)}>{tekst}</button>
                ))}
            </div>
        </div>
    );
}

export default function Host() {
    const navigate = useNavigate();
    const spel = useSpel();
    const { sessie, fase, spelers, teams, lobbyInstellingen, audio, voorbereiding } = spel;
    const spelerRef = useRef(null);
    const [startBezig, setStartBezig] = useState(false);
    const [qrGroot, setQrGroot] = useState(false);
    const [geluidViaTv, setGeluidViaTvState] = useState(() => {
        try { return localStorage.getItem(GELUID_SLEUTEL) === '1'; } catch { return false; }
    });
    const zetGeluidViaTv = (aan) => {
        setGeluidViaTvState(aan);
        try { localStorage.setItem(GELUID_SLEUTEL, aan ? '1' : '0'); } catch { /* */ }
    };

    useEffect(() => { if (!sessie) navigate('/'); }, [sessie, navigate]);
    useEffect(() => { if (fase !== 'wachten' || spel.fout) setStartBezig(false); }, [fase, spel.fout]);
    if (!sessie) return null;

    const joinUrl = `${window.location.origin}/join/${sessie.code}`;
    const tvUrl = `${window.location.origin}/tv/${sessie.code}`;

    // Ontgrendel de audio tijdens de tik op Start (iOS wil eerst een tik).
    async function start() {
        if (startBezig || voorbereiding) return;
        setStartBezig(true);
        try { if (spelerRef.current) await spelerRef.current.ontgrendel(); } catch { /* geluid komt via tik */ }
        try { spel.startSpel(); } catch { setStartBezig(false); }
    }
    const zet = (patch) => spel.bewaarLobbyInstellingen({ ...lobbyInstellingen, ...patch });

    const speler = (
        <HostPlayer ref={spelerRef} compact audio={audio} gedempt={geluidViaTv}
            gepauzeerd={spel.gepauzeerd} onPauze={spel.pauzeer} onHervat={spel.hervat} onHerhaal={spel.herhaal} />
    );

    if (fase !== 'wachten') {
        return (
            <>
                {speler}
                <Speelbord spel={spel} onVerlaten={() => navigate('/')}
                    hostBalk={<HostBalk spel={spel} geluidViaTv={geluidViaTv} onGeluid={zetGeluidViaTv} tvUrl={tvUrl} />} />
            </>
        );
    }

    const zonderTeam = spelers.filter((s) => !s.team_naam);
    return (
        <main className="kz kz-hostlobby">
            {speler}
            <header className="kz-kop">
                <span className="kz-teller">Lobby</span>
                <span className="kz-kop-midden"><b className="kz-code">{sessie.code}</b></span>
                <button type="button" className="kz-icoon" onClick={() => navigate('/')} aria-label="Naar start">×</button>
            </header>
            <div className="kz-lobby-raster">
                <section className="kz-lobby-qr">
                    <button type="button" className="kz-qr" onClick={() => setQrGroot(true)} aria-label="QR-code vergroten">
                        <QRCodeSVG value={joinUrl} size={168} bgColor="#ffffff" fgColor="#111111" includeMargin />
                    </button>
                    <p className="kz-sub">Scan of ga naar <b>{window.location.host}</b> · code <b>{sessie.code}</b></p>
                    <div className="kz-rij">
                        <button type="button" className="kz-pil" onClick={() => {
                            if (navigator.share) navigator.share({ title: 'VenTune', text: `Doe mee! Code ${sessie.code}`, url: joinUrl }).catch(() => {});
                            else navigator.clipboard?.writeText(joinUrl).catch(() => {});
                        }}>Delen</button>
                        <a className="kz-pil" href={tvUrl} target="_blank" rel="noreferrer">Tv-scherm</a>
                    </div>
                </section>

                <section className="kz-lobby-spelers">
                    <div className="kz-lobby-kop">
                        <span className="kz-label">Spelers · {spelers.length}</span>
                        <span className="kz-rij kz-teams-knoppen">
                            <span className="kz-label">Teams</span>
                            {[2, 3, 4].map((n) => (
                                <button key={n} type="button" className={'kz-pil klein' + (teams.length === n ? ' aan' : '')}
                                    onClick={() => spel.verdeelTeams(n)} disabled={spelers.length < 2}>{n}</button>
                            ))}
                            {teams.length > 0 && (
                                <button type="button" className="kz-pil klein" onClick={() => {
                                    spel.bewaarLobbyInstellingen({ ...lobbyInstellingen, teams: [], spelvorm: lobbyInstellingen?.spelvorm === 'teams' ? 'tegen_elkaar' : lobbyInstellingen?.spelvorm });
                                }}>Geen</button>
                            )}
                        </span>
                    </div>
                    <div className="kz-spelers-lijst">
                        {teams.length > 0 ? (
                            <>
                                {teams.map((team) => (
                                    <div key={team} className="kz-teamvak">
                                        <strong>{team}</strong>
                                        <div>{spelers.filter((s) => s.team_naam === team).map((s) => (
                                            <span key={s.id} className={'kz-speler' + (s.verbonden ? '' : ' weg')}>{s.naam}{s.leeftijd ? <small>{s.leeftijd}</small> : null}</span>
                                        ))}</div>
                                    </div>
                                ))}
                                {zonderTeam.length > 0 && (
                                    <div className="kz-teamvak"><strong>Nog geen team</strong>
                                        <div>{zonderTeam.map((s) => <span key={s.id} className="kz-speler">{s.naam}</span>)}</div></div>
                                )}
                            </>
                        ) : (
                            <div className="kz-spelers">
                                {spelers.map((s) => (
                                    <span key={s.id} className={'kz-speler' + (s.verbonden ? '' : ' weg')}>
                                        {s.naam}{s.is_host ? <small>host</small> : s.leeftijd ? <small>{s.leeftijd}</small> : null}
                                    </span>
                                ))}
                                {spelers.length <= 1 && <span className="kz-sub">Wachten op spelers…</span>}
                            </div>
                        )}
                    </div>
                </section>

                <section className="kz-lobby-instellingen">
                    <Keuze label="Antwoorden" waarde={lobbyInstellingen?.antwoord_modus === 'typen' ? 'typen' : 'meerkeuze'}
                        opties={[['meerkeuze', 'Kiezen'], ['typen', 'Typen']]} onKies={(w) => zet({ antwoord_modus: w })} />
                    <Keuze label="Tijd" waarde={Number(lobbyInstellingen?.speeltijd ?? 0)}
                        opties={[[15, '15s'], [30, '30s'], [60, '1m'], [0, 'Heel']]} onKies={(w) => zet({ speeltijd: w })} />
                    <Keuze label="Hints" waarde={lobbyInstellingen?.hints_aan !== false}
                        opties={[[true, 'Aan'], [false, 'Uit']]} onKies={(w) => zet({ hints_aan: w })} />
                    <Keuze label="Bonus" waarde={lobbyInstellingen?.bonusvragen_aan !== false}
                        opties={[[true, 'Aan'], [false, 'Uit']]} onKies={(w) => zet({ bonusvragen_aan: w })} />
                    <Keuze label="Geluid" waarde={geluidViaTv}
                        opties={[[false, 'Hier'], [true, 'Via tv']]} onKies={zetGeluidViaTv} />
                    <Keuze label="Leeftijd" waarde={lobbyInstellingen?.leeftijd_weging !== false}
                        opties={[[true, 'Afstemmen'], [false, 'Gelijk']]} onKies={(w) => zet({ leeftijd_weging: w })} />
                </section>
            </div>

            <footer className="kz-voet kz-start">
                {spel.fout && <span className="kz-feedback fout">{spel.fout}</span>}
                {(voorbereiding || startBezig) && !spel.fout && (
                    <span className="kz-feedback">{voorbereiding?.totaal
                        ? `Nummers klaarzetten ${voorbereiding.verwerkt || 0}/${voorbereiding.totaal}`
                        : (voorbereiding?.melding || 'Voorbereiden…')}</span>
                )}
                <button className="knop kz-startknop" type="button" onClick={() => { spel.wisFout?.(); start(); }}
                    disabled={spelers.length < 1 || !!voorbereiding || startBezig}>
                    {voorbereiding || startBezig ? 'Even geduld…' : 'Start'}
                </button>
            </footer>

            {qrGroot && (
                <div className="kz-paneel-achter" role="dialog" aria-modal="true" aria-label="QR-code" onClick={() => setQrGroot(false)}>
                    <div className="kz-qr-groot">
                        <QRCodeSVG value={joinUrl} size={320} bgColor="#ffffff" fgColor="#111111" includeMargin />
                        <p className="kz-code">{sessie.code}</p>
                    </div>
                </div>
            )}
        </main>
    );
}
