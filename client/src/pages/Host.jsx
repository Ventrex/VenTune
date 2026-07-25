import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import HostPlayer from '../components/HostPlayer.jsx';
import Timer from '../components/Timer.jsx';
import Brand from '../components/Brand.jsx';

// Host-scherm (het grote scherm). Speelt de muziek af en toont de QR,
// de visualizer, de timer en het scorebord.
export default function Host() {
    const navigate = useNavigate();
    const spel = useSpel();
    const {
        sessie,
        fase,
        ronde,
        resultaat,
        hints,
        antwoordOpties,
        verwijderdeOpties,
        antwoord,
        bonus,
        bonusResultaat,
        scorebord,
        spelers,
        audio,
    } = spel;
    const spelerRef = useRef(null);
    const [gok, setGok] = useState('');
    const [bonusKeuze, setBonusKeuze] = useState(null);

    // Ontgrendel de speler tijdens de tik op 'Start spel', zodat ook latere
    // rondes vanzelf geluid geven (iOS staat afspelen alleen toe na een tik).
    async function startMetGeluid() {
        if (spelerRef.current) await spelerRef.current.ontgrendel();
        spel.startSpel();
    }

    useEffect(() => setGok(''), [ronde?.rondeId]);
    useEffect(() => setBonusKeuze(null), [bonus?.vraag]);

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);
    if (!sessie) return null;

    const joinUrl = `${window.location.origin}/join/${sessie.code}`;
    const goedGeraden = resultaat?.status === 'goed';
    const bonusVergrendeld = bonusResultaat?.status === 'goed' || bonusResultaat?.status === 'fout';

    function verstuurGok(e) {
        e.preventDefault();
        if (!gok.trim() || goedGeraden) return;
        spel.gok(gok.trim());
    }

    function kiesAntwoord(optie) {
        if (!optie || goedGeraden) return;
        setGok(optie);
        spel.gok(optie);
    }

    function kiesBonus(i) {
        if (bonusVergrendeld) return;
        setBonusKeuze(i);
        spel.bonusAntwoord(i);
    }

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    return (
        <main className="scherm host-scherm">
            <Brand compact />
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
                    <div className="kaart host-raadkaart">
                        <p className="kaart-label">Jij speelt mee</p>
                        {goedGeraden ? (
                            <p className="goed-tekst">Goed! +{resultaat.punten}</p>
                        ) : antwoordOpties ? (
                            <div className="keuzes meerkeuze-antwoorden">
                                {antwoordOpties.map((optie, i) => {
                                    const weg = verwijderdeOpties.includes(i);
                                    return (
                                        <button
                                            key={`${optie}-${i}`}
                                            className={'keuze' + (gok === optie ? ' gekozen' : '')}
                                            onClick={() => kiesAntwoord(optie)}
                                            disabled={weg}
                                        >
                                            {weg ? '—' : optie}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <form className="zoekbalk" onSubmit={verstuurGok}>
                                <input
                                    className="invoer"
                                    value={gok}
                                    onChange={(e) => setGok(e.target.value)}
                                    placeholder="Jouw antwoord…"
                                    aria-label="Jouw antwoord"
                                    autoComplete="off"
                                />
                                <button className="knop" type="submit">Raad</button>
                            </form>
                        )}
                        {resultaat && !goedGeraden && (
                            <p className={'feedback ' + (resultaat.status === 'bijna' ? 'bijna' : resultaat.status === 'fout' ? 'mis' : 'neutraal')}>
                                {resultaat.status === 'bijna' && 'Bijna!'}
                                {resultaat.status === 'fout' && 'Helaas, mis.'}
                                {resultaat.status === 'tempo' && resultaat.melding}
                                {resultaat.status === 'hint-fout' && resultaat.melding}
                            </p>
                        )}
                        {!goedGeraden && (
                            <>
                                <button
                                    className="knop knop-stil host-hintknop"
                                    type="button"
                                    onClick={spel.vraagHint}
                                >
                                    Hint (−25)
                                </button>
                                {antwoordOpties && (
                                    <button
                                        className="knop knop-stil host-hintknop"
                                        type="button"
                                        onClick={spel.verwijder3}
                                    >
                                        Verwijder 3 foute antwoorden
                                        {spel.hulplijnen.verwijder3 !== null
                                            ? ` (${spel.hulplijnen.verwijder3} over)`
                                            : ''}
                                    </button>
                                )}
                            </>
                        )}
                        {hints.length > 0 && (
                            <ul className="hintlijst">
                                {hints.map((h, i) => (
                                    <li key={i} className="hint-rij">{h.tekst}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="host-knoppen">
                        <button className="knop knop-stil" onClick={spel.herhaal}>
                            ↻ Opnieuw
                        </button>
                        <button
                            className="knop knop-stil"
                            onClick={spel.gepauzeerd ? spel.hervat : spel.pauzeer}
                        >
                            {spel.gepauzeerd ? '▶ Hervat' : '⏸ Pauze'}
                        </button>
                        <button className="knop" onClick={spel.volgende}>
                            Volgende →
                        </button>
                    </div>
                    {spel.gepauzeerd && (
                        <p className="feedback neutraal">Gepauzeerd</p>
                    )}
                    <button
                        className="terug als-link"
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => spel.meldFout('fout')}
                    >
                        {spel.melded ? '✓ Fout gemeld' : 'Fout melden (verkeerd nummer / geen geluid)'}
                    </button>
                    <p className="dim" style={{ marginTop: '1rem' }}>
                        Spelers raden op hun telefoon; jij speelt hier mee…
                    </p>
                    <Scorebord lijst={scorebord} compact mijnId={sessie.spelerId} />
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
                    <p className="dim" style={{ marginTop: '1rem' }}>
                        Spelers antwoorden op hun telefoon; jij kunt hier ook meedoen.
                    </p>
                    <div className="keuzes host-bonus-keuzes">
                        {bonus.opties.map((opt, i) => {
                            let extra = bonusKeuze === i ? ' gekozen' : '';
                            if (bonusResultaat?.status === 'fout' && bonusResultaat.correctIndex === i) extra = ' juist';
                            return (
                                <button
                                    key={i}
                                    className={'keuze' + extra}
                                    onClick={() => kiesBonus(i)}
                                    disabled={bonusVergrendeld}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                    {bonusResultaat && (
                        <p className={'feedback ' + (bonusResultaat.status === 'goed' ? 'bijna' : 'mis')}>
                            {bonusResultaat.status === 'goed' && `Goed! +${bonusResultaat.punten}`}
                            {bonusResultaat.status === 'nogmaals' && 'Nog één poging.'}
                            {bonusResultaat.status === 'fout' && 'Fout.'}
                        </p>
                    )}
                    <div className="host-knoppen">
                        <button className="knop knop-stil" onClick={spel.volgende}>Bonus overslaan →</button>
                    </div>
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
                    <Scorebord lijst={scorebord} mijnId={sessie.spelerId} />
                    <p className="dim" style={{ marginTop: '1rem' }}>
                        De volgende ronde start automatisch…
                    </p>
                </>
            )}

            {/* Einde */}
            {fase === 'einde' && (
                <>
                    <h1>Eindstand</h1>
                    <Scorebord lijst={scorebord} eind mijnId={sessie.spelerId} />
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
            {antwoord.poster && (
                <img className="poster" src={antwoord.poster} alt="" loading="lazy" />
            )}
            <div className="info-rij">
                <span className="info-chip">{type}</span>
                {antwoord.jaar && <span className="info-chip">{antwoord.jaar}</span>}
                <span className="info-chip">{taal}</span>
                {antwoord.land && <span className="info-chip">{antwoord.land}</span>}
                {(antwoord.genres || []).map((g) => (
                    <span key={g} className="info-chip">{g}</span>
                ))}
            </div>
            {antwoord.omschrijving && (
                <p className="omschrijving">{antwoord.omschrijving}</p>
            )}
            <p className="dim">
                {antwoord.tracknaam}
                {antwoord.artiest ? ` — ${antwoord.artiest}` : ''}
            </p>
        </>
    );
}

function Scorebord({ lijst, compact, eind, mijnId }) {
    if (!lijst || lijst.length === 0) return null;
    return (
        <ul className="scorebord" style={{ marginTop: compact ? '1.5rem' : '1rem' }}>
            {lijst.map((s, i) => (
                <li
                    key={s.id}
                    className={'score-rij' + (s.id === mijnId ? ' actief' : '') + (eind && i === 0 ? ' winnaar' : '')}
                >
                    <span className="score-plek">{i + 1}</span>
                    <span className="score-naam">{s.naam}</span>
                    <span className="score-punten">{s.score}</span>
                </li>
            ))}
        </ul>
    );
}
