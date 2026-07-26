import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import Visualizer from '../components/Visualizer.jsx';
import { AntwoordInfo } from './Host.jsx';
import Timer from '../components/Timer.jsx';

// Spelerscherm (telefoon). Geen audio, geen titel — alleen de visualizer
// en het raadveld. Feedback komt van de server.
export default function Play() {
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
        verbonden,
        herstelNodig,
        herstelBezig,
    } = spel;
    const [gok, setGok] = useState('');
    const [gokIngediend, setGokIngediend] = useState(false);
    const [bonusKeuze, setBonusKeuze] = useState(null);
    const [bonusWachtTot, setBonusWachtTot] = useState(0);
    const [, setBonusTik] = useState(0);

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);

    // Bij een nieuwe ronde het invoerveld leegmaken.
    useEffect(() => {
        setGok('');
        setGokIngediend(false);
    }, [ronde?.rondeId]);

    // Nieuwe bonusvraag → keuze resetten.
    useEffect(() => {
        setBonusKeuze(null);
        setBonusWachtTot(0);
    }, [bonus?.vraag]);

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

    const bonusVergrendeld =
        bonusResultaat?.status === 'goed' || bonusResultaat?.status === 'opgegeven';
    const bonusWacht = bonusWachtTot > Date.now();
    const bonusUitgesloten = bonusResultaat?.uitgeslotenIndexen || bonus?.uitgeslotenIndexen || [];

    function kiesBonus(i) {
        if (bonusVergrendeld || bonusWacht || bonusUitgesloten.includes(i)) return;
        setBonusKeuze(i);
        spel.bonusAntwoord(i);
    }

    if (!sessie) return null;

    const goedGeraden = resultaat?.status === 'goed';
    const titelVergrendeld = gokIngediend || goedGeraden;

    function versturen(e) {
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

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    return (
        <main className="scherm">
            {spel.fout && <p className="waarschuwing">{spel.fout}</p>}
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
                                    {s.team_naam && <span className="dim"> · {s.team_naam}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {teams.length > 0 && (
                        <label className="kaart-label" style={{ display: 'block', textAlign: 'left', marginTop: '1rem' }}>
                            Jouw team
                            <select
                                className="invoer"
                                style={{ marginTop: '0.35rem' }}
                                value={spelers.find((s) => s.id === sessie.spelerId)?.team_naam || ''}
                                onChange={(e) => spel.wijzigTeam(e.target.value || null)}
                            >
                                <option value="">Geen team</option>
                                {teams.map((team) => <option key={team} value={team}>{team}</option>)}
                            </select>
                        </label>
                    )}
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
                        {ronde.durationMs ? (
                            <Timer
                                startTs={ronde.startTs}
                                durationMs={ronde.durationMs}
                            />
                        ) : (
                            <span className="dim">kenner</span>
                        )}
                    </div>
                    <Visualizer actief={!spel.gepauzeerd} />
                    {spel.gepauzeerd && (
                        <p className="feedback neutraal">Even pauze…</p>
                    )}

                    {goedGeraden ? (
                        <div className="kaart" style={{ marginTop: '1.5rem' }}>
                            <p className="goed-tekst">Goed! +{resultaat.punten}</p>
                            <p className="dim">Afspelen… wachten op de anderen</p>
                        </div>
                    ) : (
                        <>
                            {antwoordOpties ? (
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
                                    <button className="knop" type="submit" disabled={titelVergrendeld}>
                                        {gokIngediend ? 'Ingestuurd' : 'Antwoord insturen'}
                                    </button>
                                </form>
                            )}

                            <button
                                className="knop knop-stil"
                                style={{ marginTop: '0.75rem', width: '100%' }}
                                onClick={spel.vraagHint}
                            >
                                Hint (−25)
                            </button>
                            {antwoordOpties && (
                                <button
                                    className="knop knop-stil"
                                    style={{ marginTop: '0.75rem', width: '100%' }}
                                    onClick={spel.verwijder3}
                                >
                                    Verwijder 3 foute antwoorden
                                    {spel.hulplijnen.verwijder3 !== null
                                        ? ` (${spel.hulplijnen.verwijder3} over)`
                                        : ''}
                                </button>
                            )}

                            <button
                                className="terug als-link"
                                style={{ marginTop: '1rem' }}
                                onClick={() => spel.meldFout('geen_geluid')}
                            >
                                {spel.melded
                                    ? '✓ Bedankt, gemeld'
                                    : 'Iets mis? Fout melden'}
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
                                        'Bijna — je antwoord is ingestuurd.'}
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

            {/* Titel onthuld (korte tussenfase voor de bonus) */}
            {fase === 'onthul' && antwoord && (
                <>
                    <p className="kaart-label">Het antwoord was</p>
                    <h1>{antwoord.naam}</h1>
                    <AntwoordInfo antwoord={antwoord} />
                </>
            )}

            {/* Bonusvraag */}
            {fase === 'bonus' && bonus && (
                <>
                    {antwoord && (
                        <p className="ondertitel">
                            {antwoord.naam}
                            {antwoord.jaar ? ` · ${antwoord.jaar}` : ''}
                        </p>
                    )}
                    <p className="kaart-label">Bonusvraag (+50)</p>
                    <h1 className="bonus-vraag">{bonus.vraag}</h1>
                    <div className="keuzes">
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
                        <p
                            className={
                                'feedback ' +
                                (bonusResultaat.status === 'goed'
                                    ? 'bijna'
                                    : bonusResultaat.status === 'nogmaals'
                                      ? 'neutraal'
                                      : bonusResultaat.status === 'optie-weg'
                                        ? 'neutraal'
                                        : 'mis')
                            }
                        >
                            {bonusResultaat.status === 'goed' &&
                                `Goed! +${bonusResultaat.punten}`}
                            {bonusResultaat.status === 'nogmaals' &&
                                'Helaas — kies over vijf seconden een andere optie.'}
                            {bonusResultaat.status === 'optie-weg' &&
                                'Deze foute optie is voor iedereen verwijderd.'}
                            {bonusResultaat.status === 'fout' &&
                                `Fout. ${Math.ceil(Math.max(0, bonusWachtTot - Date.now()) / 1000)}s denktijd.`}
                            {bonusResultaat.status === 'wachten' &&
                                `Even wachten: ${Math.ceil((bonusWachtTot - Date.now()) / 1000)}s.`}
                            {bonusResultaat.status === 'opgegeven' && 'Opgegeven.'}
                        </p>
                    )}
                    {!bonusVergrendeld && (
                        <button className="knop knop-stil" style={{ marginTop: '1rem', width: '100%' }} onClick={spel.bonusOpgeven}>
                            Ik geef op
                        </button>
                    )}
                    <p className="dim" style={{ marginTop: '0.75rem' }}>Hoe sneller je goed antwoordt, hoe meer bonuspunten.</p>
                </>
            )}

            {/* Scorebord tussen rondes */}
            {fase === 'scorebord' && (
                <>
                    {antwoord && (
                        <>
                            <p className="kaart-label">Vorige titel</p>
                            <h1>{antwoord.naam}</h1>
                            <AntwoordInfo antwoord={antwoord} />
                        </>
                    )}
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
                    {s.team_naam && <span className="dim score-team">{s.team_naam} · team {s.team_score ?? 0}</span>}
                    <span className="score-punten">{s.score}</span>
                </li>
            ))}
        </ul>
    );
}
