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
        teams,
        lobbyInstellingen,
        audio,
        verbonden,
        herstelNodig,
        herstelBezig,
        voorbereiding,
    } = spel;
    const spelerRef = useRef(null);
    const [gok, setGok] = useState('');
    const [gokIngediend, setGokIngediend] = useState(false);
    const [bonusKeuze, setBonusKeuze] = useState(null);
    const [bonusWachtTot, setBonusWachtTot] = useState(0);
    const [, setBonusTik] = useState(0);
    const [nieuwTeam, setNieuwTeam] = useState('');
    const [lobbyWijziging, setLobbyWijziging] = useState(null);
    const [startBezig, setStartBezig] = useState(false);
    const [audioStatus, setAudioStatus] = useState(null);

    // Ontgrendel de speler tijdens de tik op 'Start spel', zodat ook latere
    // rondes vanzelf geluid geven (iOS staat afspelen alleen toe na een tik).
    async function startMetGeluid() {
        if (startBezig || voorbereiding) return;
        setStartBezig(true);
        // Het ontgrendelen mag het starten nooit tegenhouden. Lukt het niet,
        // dan verschijnt straks hooguit de "Tik om te starten"-knop; blijft
        // het hangen, dan zou het spel anders nooit beginnen.
        try {
            if (spelerRef.current) await spelerRef.current.ontgrendel();
        } catch {
            /* geluid komt dan via een tik; doorgaan met starten */
        }
        try {
            spel.startSpel();
        } catch {
            setStartBezig(false);
        }
    }

    useEffect(() => {
        if (fase !== 'wachten' || spel.fout) setStartBezig(false);
    }, [fase, spel.fout]);

    useEffect(() => { setGok(''); setGokIngediend(false); setAudioStatus(null); }, [ronde?.rondeId]);
    useEffect(() => {
        if (resultaat?.opnieuw) setGokIngediend(false);
    }, [resultaat]);
    useEffect(() => { setBonusKeuze(null); setBonusWachtTot(0); }, [bonus?.vraag]);
    useEffect(() => {
        if (!bonusWachtTot) return undefined;
        const timer = setInterval(() => {
            setBonusTik(Date.now());
            if (Date.now() >= bonusWachtTot) setBonusWachtTot(0);
        }, 250);
        return () => clearInterval(timer);
    }, [bonusWachtTot]);
    useEffect(() => {
        const ms = Number(bonusResultaat?.cooldownMs || bonusResultaat?.resterendMs || 0);
        if (ms > 0) setBonusWachtTot(Date.now() + ms);
    }, [bonusResultaat]);

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);
    if (!sessie) return null;

    const joinUrl = `${window.location.origin}/join/${sessie.code}`;
    const goedGeraden = resultaat?.status === 'goed';
    const titelVergrendeld = gokIngediend || goedGeraden;
    const bonusVergrendeld = bonusResultaat?.status === 'goed' || bonusResultaat?.status === 'opgegeven';
    const bonusWacht = bonusWachtTot > Date.now();
    const bonusUitgesloten = bonusResultaat?.uitgeslotenIndexen || bonus?.uitgeslotenIndexen || [];

    useEffect(() => {
        if (fase === 'wachten') setLobbyWijziging({ ...lobbyInstellingen });
    }, [fase, lobbyInstellingen]);

    function verstuurGok(e) {
        e.preventDefault();
        if (!gok.trim() || titelVergrendeld) return;
        setGokIngediend(true);
        spel.gok(gok.trim());
    }

    function kiesAntwoord(optie) {
        if (!optie || titelVergrendeld) return;
        setGok(optie);
        setGokIngediend(true);
        spel.gok(optie);
    }

    function kiesBonus(i) {
        if (bonusVergrendeld || bonusWacht || bonusUitgesloten.includes(i)) return;
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
            {/* Al vóór de start gemonteerd: de klik op "Start spel" kan de
                browser zo echt ontgrendelen voor latere lokale audio. */}
            <HostPlayer ref={spelerRef} audio={audio} verborgen={fase !== 'raden'} onStatus={setAudioStatus} />
            {fase === 'raden' && ronde && !audio && (
                <p className="dim host-audio-status" role="status">Audio wordt klaargezet…</p>
            )}
            {fase === 'raden' && audio && audioStatus?.status === 'laden' && (
                <p className="dim host-audio-status" role="status">Audio ontvangen · lokaal bestand starten…</p>
            )}
            {fase === 'raden' && audioStatus?.status === 'fout' && (
                <p className="waarschuwing host-audio-status" role="alert">{audioStatus.fout}</p>
            )}
            {spel.fout && (
                <div className="foutkaart" role="alert">
                    <p className="waarschuwing" style={{ margin: 0 }}>{spel.fout}</p>
                    {/* Zonder deze knoppen zit je vast op de foutmelding: het
                        spel start niet en er is geen weg terug. */}
                    <div className="knoprij">
                        <button
                            className="knop"
                            type="button"
                            onClick={() => { spel.wisFout?.(); startMetGeluid(); }}
                        >
                            Opnieuw proberen
                        </button>
                        <button
                            className="knop knop-stil"
                            type="button"
                            onClick={() => navigate('/setup')}
                        >
                            Andere quiz kiezen
                        </button>
                        <button
                            className="knop knop-stil"
                            type="button"
                            onClick={() => navigate('/')}
                        >
                            Naar start
                        </button>
                    </div>
                </div>
            )}
            {((!verbonden && fase !== 'wachten') || herstelNodig) && (
                <div className="herstelkaart" role="status">
                    <strong>
                        {verbonden ? 'Deze ronde reageert niet.' : 'Verbinding verbroken.'}
                    </strong>
                    <p>Blijf in het spel; vernieuw de pagina niet.</p>
                    <button
                        className="knop"
                        onClick={spel.herstelSpel}
                        disabled={herstelBezig}
                    >
                        {herstelBezig ? 'Herstellen…' : 'Opnieuw verbinden / ronde herstellen'}
                    </button>
                </div>
            )}

            {/* Wachtruimte — in landscape: spelers links, QR rechts */}
            {fase === 'wachten' && (
                <>
                    <h1>Lobby</h1>
                    <p className="dim">Leeftijd deelnemers: {lobbyInstellingen?.leeftijd_deelnemer_min || 4}–{lobbyInstellingen?.leeftijd_deelnemer_max || 99}</p>
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
                                            {s.team_naam && <span className="dim"> · {s.team_naam}</span>}
                                            {s.leeftijd && <span className="dim"> · {s.leeftijd} jaar</span>}
                                        </span>
                                    </li>
                                ))}
                                {spelers.length === 0 && (
                                    <li className="dim">Nog niemand — scan de QR →</li>
                                )}
                            </ul>
                            <div className="kaart lobby-instellingen">
                                <p className="kaart-label">Lobby aanpassen</p>
                                <div className="velden">
                                    <select
                                        className="invoer"
                                        value={lobbyWijziging?.antwoord_modus || 'typen'}
                                        onChange={(e) => setLobbyWijziging({ ...lobbyWijziging, antwoord_modus: e.target.value })}
                                    >
                                        <option value="typen">Typen</option>
                                        <option value="meerkeuze">6 opties</option>
                                    </select>
                                    <select
                                        className="invoer"
                                        value={String(lobbyWijziging?.speeltijd ?? 0)}
                                        onChange={(e) => setLobbyWijziging({ ...lobbyWijziging, speeltijd: Number(e.target.value) })}
                                    >
                                        <option value="0">Heel nummer</option><option value="30">30 seconden</option><option value="60">1 minuut</option>
                                    </select>
                                </div>
                                <div className="zoekbalk" style={{ marginTop: '0.5rem' }}>
                                    <input className="invoer" value={nieuwTeam} placeholder="Nieuw team" maxLength={24} onChange={(e) => setNieuwTeam(e.target.value)} />
                                    <button className="knop knop-stil" type="button" onClick={() => {
                                        const naam = nieuwTeam.trim();
                                        if (!naam) return;
                                        const volgende = [...new Set([...(lobbyWijziging?.teams || teams || []), naam])];
                                        setLobbyWijziging({ ...lobbyWijziging, teams: volgende });
                                        setNieuwTeam('');
                                    }}>Team toevoegen</button>
                                </div>
                                {(lobbyWijziging?.teams || teams || []).length > 0 && <div className="chips">
                                    {(lobbyWijziging?.teams || teams || []).map((team) => <span className="chip gekozen" key={team}>{team}</span>)}
                                </div>}
                                {(teams || []).length > 0 && (
                                    <div className="kaart team-keuze-kaart">
                                        <p className="kaart-label">Jouw team</p>
                                        <div className="chips team-chips">
                                            <button className="chip" type="button" onClick={() => spel.wijzigTeam(null)}>Geen team</button>
                                            {teams.map((team) => {
                                                const actief = spelers.find((s) => s.id === sessie.spelerId)?.team_naam === team;
                                                return (
                                                    <button className={'chip' + (actief ? ' gekozen' : '')} type="button" key={team} onClick={() => spel.wijzigTeam(team)}>
                                                        {team}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                <button className="knop knop-stil" type="button" onClick={() => spel.bewaarLobbyInstellingen(lobbyWijziging || {})}>Instellingen opslaan</button>
                            </div>
                            {(voorbereiding || startBezig) && (
                                <div className="kaart" style={{ marginTop: '1.5rem' }} role="status">
                                    <strong>{voorbereiding?.melding || 'Spel voorbereiden… even geduld.'}</strong>
                                    {voorbereiding?.totaal > 0 && (
                                        <>
                                            <div className="admin-progress" style={{ marginTop: '0.75rem' }}>
                                                <span style={{ width: `${Math.min(100, Math.round(((voorbereiding.verwerkt || 0) / voorbereiding.totaal) * 100))}%` }} />
                                            </div>
                                            <p className="dim">{voorbereiding.verwerkt || 0} van {voorbereiding.totaal} volledig opgeslagen</p>
                                        </>
                                    )}
                                    <p className="dim">Het spel start pas wanneer elk nummer 100% lokaal beschikbaar is.</p>
                                </div>
                            )}
                            <div className="stapel" style={{ marginTop: '1.5rem' }}>
                                <button
                                    className="knop"
                                    onClick={startMetGeluid}
                                    disabled={spelers.length < 1 || !!voorbereiding || startBezig}
                                >
                                    {voorbereiding || startBezig ? 'Spel voorbereiden…' : 'Start spel'}
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

                    {/* Bediening van de muziek staat bovenaan, direct onder de
                        teller. Stond eerst onder de raadkaart, waardoor je op
                        een telefoon moest scrollen om te kunnen pauzeren. */}
                    <div className="muziekbalk">
                        <button
                            className="knop knop-stil"
                            type="button"
                            onClick={spel.gepauzeerd ? spel.hervat : spel.pauzeer}
                        >
                            {spel.gepauzeerd ? '▶ Hervat' : '⏸ Pauze'}
                        </button>
                        <button
                            className="knop knop-stil"
                            type="button"
                            onClick={spel.herhaal}
                            title="Het nummer opnieuw vanaf het begin"
                        >
                            ↻ Vanaf begin
                        </button>
                    </div>
                    {spel.gepauzeerd && (
                        <p className="feedback neutraal">Gepauzeerd</p>
                    )}

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
                                            className={'keuze' + (gok === optie ? ' gekozen' : '') +
                                                (gok === optie && resultaat?.status !== 'goed' ? ' fout' : '')}
                                            onClick={() => kiesAntwoord(optie)}
                                            disabled={weg || titelVergrendeld}
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
                                    <button className="knop" type="submit" disabled={titelVergrendeld}>{gokIngediend ? 'Ingestuurd' : 'Antwoord insturen'}</button>
                            </form>
                        )}
                        {resultaat && !goedGeraden && (
                            <p className={'feedback ' + (resultaat.status === 'bijna' ? 'bijna' : resultaat.status === 'fout' ? 'mis' : 'neutraal')}>
                                {resultaat.status === 'bijna' && (resultaat.melding || 'Bijna — je antwoord is ingestuurd.')}
                                {resultaat.status === 'fout' && (resultaat.melding || 'Helaas, mis.')}
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
                        <button className="knop" onClick={spel.volgende}>
                            Volgende →
                        </button>
                    </div>
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
                            if (bonusResultaat?.status === 'goed' && bonusResultaat.correctIndex === i) extra += ' juist';
                            if (bonusUitgesloten.includes(i)) extra += ' fout';
                            return (
                                <button
                                    key={i}
                                    className={'keuze' + extra}
                                    onClick={() => kiesBonus(i)}
                                    disabled={bonusVergrendeld || bonusWacht || bonusUitgesloten.includes(i)}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                    {bonusResultaat && (
                        <p className={'feedback ' + (bonusResultaat.status === 'goed' ? 'bijna' : bonusResultaat.status === 'optie-weg' ? 'neutraal' : 'mis')}>
                            {bonusResultaat.status === 'goed' && `Goed! +${bonusResultaat.punten}`}
                            {bonusResultaat.status === 'nogmaals' && 'Kies over vijf seconden een andere optie.'}
                            {bonusResultaat.status === 'optie-weg' && 'Deze foute optie is voor iedereen verwijderd.'}
                            {bonusResultaat.status === 'fout' && `Fout. ${Math.ceil(Math.max(0, bonusWachtTot - Date.now()) / 1000)}s denktijd.`}
                            {bonusResultaat.status === 'wachten' && `Even wachten: ${Math.ceil(Math.max(0, bonusWachtTot - Date.now()) / 1000)}s.`}
                            {bonusResultaat.status === 'opgegeven' && 'Opgegeven.'}
                        </p>
                    )}
                    <div className="host-knoppen">
                        {!bonusVergrendeld && <button className="knop knop-stil" onClick={spel.bonusOpgeven}>Ik geef op</button>}
                        <button className="knop knop-stil" onClick={spel.volgende}>Volgende bonusvraag →</button>
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
                        Afspelen… volgende ronde start automatisch
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
            {antwoord.tmdbUrl && (
                <p><a className="terug" href={antwoord.tmdbUrl} target="_blank" rel="noreferrer">Bekijk film/serie ↗</a></p>
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
                    {s.team_naam && <span className="dim score-team">{s.team_naam} · team {s.team_score ?? 0}</span>}
                    <span className="score-punten">{s.score}</span>
                </li>
            ))}
        </ul>
    );
}
