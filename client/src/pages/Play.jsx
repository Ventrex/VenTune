import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import Visualizer from '../components/Visualizer.jsx';
import { AntwoordInfo } from './Host.jsx';
import Timer from '../components/Timer.jsx';
import { dienBonusVraagIn } from '../lib/api.js';

// Spelerscherm (telefoon). Geen audio, geen titel — alleen de visualizer
// en het raadveld. Feedback komt van de server.
export default function Play() {
    const navigate = useNavigate();
    const spel = useSpel();
    const {
        sessie,
        lobbyInstellingen,
        trackBeoordeling,
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
    const [meldingOpen, setMeldingOpen] = useState(false);
    const [meldingSoort, setMeldingSoort] = useState('geen_geluid');
    const [meldingToelichting, setMeldingToelichting] = useState('');
    const [, setBonusTik] = useState(0);

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);

    // Bij een nieuwe ronde het invoerveld leegmaken.
    useEffect(() => {
        setGok('');
        setGokIngediend(false);
    }, [ronde?.rondeId]);
    useEffect(() => {
        if (resultaat?.opnieuw) setGokIngediend(false);
    }, [resultaat]);

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
                        <div className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }}>
                            <p className="kaart-label">Kies je team</p>
                            <div className="chips team-chips">
                                <button className={'chip' + (!spelers.find((s) => s.id === sessie.spelerId)?.team_naam ? ' gekozen' : '')} onClick={() => spel.wijzigTeam(null)}>Geen team</button>
                                {teams.map((team) => {
                                    const actief = spelers.find((s) => s.id === sessie.spelerId)?.team_naam === team;
                                    return <button className={'chip' + (actief ? ' gekozen' : '')} key={team} onClick={() => spel.wijzigTeam(team)}>{team}</button>;
                                })}
                            </div>
                        </div>
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

                            {lobbyInstellingen?.vraag_profiel === 'beta' && (
                                <div className="kaart beta-review" style={{ marginTop: '1rem', textAlign: 'left' }}>
                                    <p className="kaart-label">Beta Tester · klopt dit nummer?</p>
                                    {trackBeoordeling ? (
                                        <p className="goed-tekst">
                                            {trackBeoordeling.beoordeling === 'goed'
                                                ? '✓ Als goed gemarkeerd.'
                                                : trackBeoordeling.alternatief?.gedownload
                                                    ? '↻ Fout gemeld; een andere kandidaat wordt klaargezet.'
                                                    : '✗ Als fout gemarkeerd; beheer controleert de kandidaat.'}
                                        </p>
                                    ) : (
                                        <div className="zoekbalk">
                                            <button
                                                className="knop"
                                                type="button"
                                                onClick={() => spel.beoordeelTrack('goed')}
                                            >
                                                ✓ Nummer klopt
                                            </button>
                                            <button
                                                className="knop knop-stil"
                                                type="button"
                                                onClick={() => spel.beoordeelTrack('fout', window.prompt('Wat klopt er niet? (optioneel)', '') || null)}
                                            >
                                                ✗ Nummer klopt niet
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="melding-formulier" style={{ marginTop: '1rem' }}>
                                {spel.melded ? (
                                    <p className="goed-tekst">✓ Bedankt, je melding is ontvangen.</p>
                                ) : (
                                    <>
                                        <div className="zoekbalk melding-keuze">
                                            <select
                                                className="invoer compact-select"
                                                value={meldingSoort}
                                                onChange={(e) => setMeldingSoort(e.target.value)}
                                                aria-label="Wat is er mis?"
                                            >
                                                <option value="geen_geluid">Geen geluid</option>
                                                <option value="verkeerd_nummer">Verkeerd nummer</option>
                                                <option value="fout">Anders</option>
                                            </select>
                                            <button
                                                className="knop knop-stil"
                                                type="button"
                                                onClick={() => setMeldingOpen((waarde) => !waarde)}
                                            >
                                                {meldingOpen ? 'Sluiten' : 'Melding maken'}
                                            </button>
                                        </div>
                                        {meldingOpen && (
                                            <div className="stapel melding-details" style={{ marginTop: '0.5rem' }}>
                                                <input
                                                    className="invoer"
                                                    value={meldingToelichting}
                                                    onChange={(e) => setMeldingToelichting(e.target.value)}
                                                    placeholder="Wat ging er mis? (optioneel)"
                                                    maxLength={500}
                                                />
                                                <button
                                                    className="knop"
                                                    type="button"
                                                    onClick={() => {
                                                        spel.meldFout(meldingSoort, meldingToelichting.trim() || null);
                                                        setMeldingOpen(false);
                                                    }}
                                                >
                                                    Melding versturen
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

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
                                        (resultaat.melding || 'Bijna — je antwoord is ingestuurd.')}
                                    {resultaat.status === 'fout' &&
                                        (resultaat.melding || 'Helaas, mis.')}
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
                    <BonusVraagInsturen titelId={antwoord.titelId} />
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
                    <BonusVraagInsturen titelId={antwoord?.titelId} />
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
                    {antwoord && <BonusVraagInsturen titelId={antwoord.titelId} />}
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

function BonusVraagInsturen({ titelId }) {
    const [open, setOpen] = useState(false);
    const [vraag, setVraag] = useState('');
    const [naam, setNaam] = useState('');
    const [opties, setOpties] = useState(Array.from({ length: 6 }, () => ''));
    const [juist, setJuist] = useState(0);
    const [status, setStatus] = useState('');
    if (!titelId) return null;

    async function verstuur(e) {
        e.preventDefault();
        setStatus('Bezig…');
        try {
            await dienBonusVraagIn(titelId, {
                vraag,
                opties,
                correct_index: juist,
                speler_naam: naam,
            });
            setStatus('Bedankt! De admin beoordeelt je vraag.');
            setOpen(false);
            setVraag('');
            setNaam('');
            setOpties(Array.from({ length: 6 }, () => ''));
        } catch (err) {
            setStatus(err.message);
        }
    }

    return (
        <div className="kaart" style={{ marginTop: '1.25rem', textAlign: 'left' }}>
            <button className="knop knop-stil" type="button" onClick={() => setOpen((waarde) => !waarde)}>
                {open ? 'Bonusvraag sluiten' : 'Zelf een bonusvraag insturen'}
            </button>
            {status && <p className="dim" style={{ marginBottom: 0 }}>{status}</p>}
            {open && (
                <form className="stapel" style={{ marginTop: '0.75rem' }} onSubmit={verstuur}>
                    <input className="invoer" value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Jouw naam (optioneel)" maxLength={80} />
                    <input className="invoer" required value={vraag} onChange={(e) => setVraag(e.target.value)} placeholder="Vraag" maxLength={500} />
                    {opties.map((optie, i) => (
                        <div className="zoekbalk" key={i}>
                            <input
                                className="invoer"
                                required
                                value={optie}
                                onChange={(e) => setOpties((oud) => oud.map((x, index) => index === i ? e.target.value : x))}
                                placeholder={`Antwoord ${i + 1}`}
                                maxLength={160}
                            />
                            <label className="keuze klein">
                                <input type="radio" name={`juist-${titelId}`} checked={juist === i} onChange={() => setJuist(i)} />
                                juist
                            </label>
                        </div>
                    ))}
                    <button className="knop" type="submit" disabled={status === 'Bezig…'}>Insturen ter goedkeuring</button>
                </form>
            )}
        </div>
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
