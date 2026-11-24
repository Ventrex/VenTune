import React, { useEffect, useState } from 'react';
import Timer from './Timer.jsx';
import IssueReport from './IssueReport.jsx';
import KingOfTheHill from './KingOfTheHill.jsx';
import { dienBonusVraagIn } from '../lib/api.js';

// =====================================================================
// Speelbord — het spelscherm in Kahoot-stijl, voor spelers én de host.
//
// Altijd precies schermvullend (100dvh), nooit scrollen: bovenin de
// vraag, daaronder grote gekleurde antwoordtegels. Alles wat niet nodig
// is tijdens het raden (melden, grotere letters, vraag insturen) zit
// achter de ⋯-knop in een paneel.
// =====================================================================

const VORMEN = ['▲', '◆', '●', '■', '★', '⬣'];
const TIER = { iconisch: 'Iconisch', algemeen_bekend: 'Algemeen bekend', bekend: 'Bekend', onbekend: 'Onbekend', cult: 'Cult' };

export function Tegels({ opties, onKies, uit = [], gekozen = null, juist = null, fout = [], vergrendeld = false }) {
    return (
        <div className={'kz-tegels kz-tegels-' + Math.min(6, Math.max(2, opties.length))}>
            {opties.map((optie, i) => {
                const weg = uit.includes(i);
                const klasse = 'kz-tegel kz-k' + (i % 6 + 1)
                    + (gekozen === i ? ' gekozen' : '')
                    + (juist === i ? ' juist' : '')
                    + (fout.includes(i) ? ' fout' : '')
                    + (weg ? ' weg' : '');
                return (
                    <button key={`${optie}-${i}`} type="button" className={klasse}
                        disabled={weg || vergrendeld} onClick={() => onKies(i, optie)}>
                        <span className="kz-vorm" aria-hidden="true">{VORMEN[i % 6]}</span>
                        <span className="kz-tekst">{weg ? '' : optie}</span>
                    </button>
                );
            })}
        </div>
    );
}

function jaarTekst(a) {
    if (!a?.jaar) return '';
    if (a.lopend) return `${a.jaar}–`;
    if (a.eindJaar && a.eindJaar !== a.jaar) return `${a.jaar}–${a.eindJaar}`;
    return String(a.jaar);
}

function Stand({ lijst = [], mijnId, max = 5, eind = false }) {
    if (!lijst.length) return null;
    const mijnPlek = lijst.findIndex((s) => s.id === mijnId);
    const top = lijst.slice(0, max);
    return (
        <ol className={'kz-stand' + (eind ? ' eind' : '')}>
            {top.map((s, i) => (
                <li key={s.id} className={(s.id === mijnId ? 'ik ' : '') + (i < 3 && eind ? `plek-${i + 1}` : '')}>
                    <span className="kz-plek">{i + 1}</span>
                    <span className="kz-naam">{s.naam}{s.team_naam && s.team_naam !== s.naam ? <small> · {s.team_naam}</small> : null}</span>
                    <span className="kz-punten">{s.score}</span>
                </li>
            ))}
            {mijnPlek >= max && (
                <li className="ik"><span className="kz-plek">{mijnPlek + 1}</span>
                    <span className="kz-naam">{lijst[mijnPlek].naam}</span>
                    <span className="kz-punten">{lijst[mijnPlek].score}</span></li>
            )}
        </ol>
    );
}

export function AntwoordKaart({ antwoord, uitslag = null }) {
    if (!antwoord) return null;
    const sub = [antwoord.tracknaam && antwoord.tracknaam !== antwoord.naam ? antwoord.tracknaam : null, antwoord.artiest, jaarTekst(antwoord)].filter(Boolean).join(' · ');
    return (
        <div className="kz-antwoord-kaart">
            {antwoord.poster && <img src={antwoord.poster} alt="" />}
            <div>
                <span className="kz-label">Het antwoord</span>
                <strong>{antwoord.naam}</strong>
                {sub && <small>{sub}</small>}
            </div>
            {uitslag && <b className={'kz-uitslag ' + (uitslag.goed ? 'goed' : 'fout')}>{uitslag.goed ? `+${uitslag.punten}` : '✕'}</b>}
        </div>
    );
}

function BonusVraagInsturen({ titelId }) {
    const [vraag, setVraag] = useState('');
    const [opties, setOpties] = useState(['', '', '', '', '', '']);
    const [juist, setJuist] = useState(0);
    const [status, setStatus] = useState('');
    if (!titelId) return null;
    async function verstuur(e) {
        e.preventDefault();
        setStatus('Bezig…');
        try {
            await dienBonusVraagIn(titelId, { vraag, opties, correct_index: juist });
            setStatus('Bedankt! De beheerder bekijkt je vraag.');
            setVraag('');
            setOpties(['', '', '', '', '', '']);
        } catch (err) { setStatus(err.message); }
    }
    return (
        <form className="kz-paneel-blok" onSubmit={verstuur}>
            <h3>Zelf een bonusvraag bedenken</h3>
            <input className="invoer" required value={vraag} onChange={(e) => setVraag(e.target.value)} placeholder="Vraag" maxLength={300} />
            {opties.map((o, i) => (
                <label key={i} className="kz-optie-invoer">
                    <input type="radio" name={'juist-' + titelId} checked={juist === i} onChange={() => setJuist(i)} aria-label="Juist antwoord" />
                    <input className="invoer" required value={o} placeholder={`Antwoord ${i + 1}`} maxLength={120}
                        onChange={(e) => setOpties((oud) => oud.map((x, j) => (j === i ? e.target.value : x)))} />
                </label>
            ))}
            <button className="knop" type="submit" disabled={status === 'Bezig…'}>Insturen</button>
            {status && <p className="dim">{status}</p>}
        </form>
    );
}

/** Uitklappaneel achter ⋯: alles wat niet op het speelscherm hoeft. */
function MeerPaneel({ spel, onSluit, groteLetters, onLetters, onVerlaten }) {
    const { fase, antwoord, ronde, lobbyInstellingen, trackBeoordeling } = spel;
    const [herkend, setHerkend] = useState(null);
    return (
        <div className="kz-paneel-achter" role="dialog" aria-modal="true" aria-label="Meer opties" onClick={onSluit}>
            <div className="kz-paneel" onClick={(e) => e.stopPropagation()}>
                <div className="kz-paneel-kop">
                    <strong>Opties</strong>
                    <button type="button" className="kz-icoon" onClick={onSluit} aria-label="Sluiten">×</button>
                </div>
                <div className="kz-paneel-blok kz-rij">
                    <button type="button" className="knop knop-stil" aria-pressed={groteLetters} onClick={onLetters}>
                        Aa {groteLetters ? 'Normale letters' : 'Grotere letters'}
                    </button>
                </div>
                {['onthul', 'bonus', 'scorebord'].includes(fase) && antwoord && (
                    <div className="kz-paneel-blok">
                        <h3>Kende je {antwoord.naam}?</h3>
                        <div className="kz-rij">
                            <button type="button" className="knop knop-stil" aria-pressed={herkend === true}
                                onClick={() => { spel.beoordeelHerkenbaarheid(true); setHerkend(true); }}>Ja</button>
                            <button type="button" className="knop knop-stil" aria-pressed={herkend === false}
                                onClick={() => { spel.beoordeelHerkenbaarheid(false); setHerkend(false); }}>Nee</button>
                        </div>
                    </div>
                )}
                {fase === 'raden' && lobbyInstellingen?.vraag_profiel === 'beta' && (
                    <div className="kz-paneel-blok">
                        <h3>Klopt dit nummer?</h3>
                        {trackBeoordeling ? <p className="dim">Bedankt, doorgegeven.</p> : (
                            <div className="kz-rij">
                                <button type="button" className="knop knop-stil" onClick={() => spel.beoordeelTrack('goed')}>Klopt</button>
                                <button type="button" className="knop knop-stil" onClick={() => spel.beoordeelTrack('fout', null)}>Klopt niet</button>
                            </div>
                        )}
                    </div>
                )}
                {fase !== 'wachten' && fase !== 'einde' && (
                    <div className="kz-paneel-blok">
                        <IssueReport key={ronde?.rondeId + fase} spel={spel} tijdensRonde={fase === 'raden'} />
                    </div>
                )}
                {antwoord?.titelId && ['onthul', 'bonus', 'scorebord'].includes(fase) && <BonusVraagInsturen titelId={antwoord.titelId} />}
                {onVerlaten && (
                    <div className="kz-paneel-blok">
                        <button type="button" className="knop knop-stil" onClick={onVerlaten}>Spel verlaten</button>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * @param spel        resultaat van useSpel()
 * @param hostBalk    optioneel: bedieningsbalk voor de host
 * @param onVerlaten  terug naar start
 */
export default function Speelbord({ spel, hostBalk = null, onVerlaten }) {
    const {
        sessie, fase, ronde, resultaat, hints, antwoordOpties, verwijderdeOpties,
        toeschouwerTitel, antwoord, bonus, bonusResultaat, scorebord, koth, lobbyInstellingen,
    } = spel;
    const [gekozen, setGekozen] = useState(null);
    const [getypt, setGetypt] = useState('');
    const [ingediend, setIngediend] = useState(false);
    const [bonusKeuze, setBonusKeuze] = useState(null);
    const [bonusWachtTot, setBonusWachtTot] = useState(0);
    const [, tik] = useState(0);
    const [meerOpen, setMeerOpen] = useState(false);
    const [groteLetters, setGroteLetters] = useState(() => {
        try { return localStorage.getItem('vt_grote_letters') === '1'; } catch { return false; }
    });
    const [mijnUitslag, setMijnUitslag] = useState(null);

    useEffect(() => { setGekozen(null); setGetypt(''); setIngediend(false); setMijnUitslag(null); }, [ronde?.rondeId]);
    useEffect(() => { if (resultaat?.opnieuw) setIngediend(false); }, [resultaat]);
    useEffect(() => {
        if (resultaat?.status === 'goed') setMijnUitslag({ goed: true, punten: resultaat.punten });
        else if (resultaat?.status === 'fout' && !resultaat.opnieuw) setMijnUitslag({ goed: false });
    }, [resultaat]);
    useEffect(() => { setBonusKeuze(null); setBonusWachtTot(0); }, [bonus?.vraag]);
    useEffect(() => {
        const ms = Number(bonusResultaat?.cooldownMs || bonusResultaat?.resterendMs || 0);
        if (ms > 0) setBonusWachtTot(Date.now() + ms);
    }, [bonusResultaat]);
    useEffect(() => {
        if (!bonusWachtTot) return undefined;
        const t = setInterval(() => { tik(Date.now()); if (Date.now() >= bonusWachtTot) setBonusWachtTot(0); }, 250);
        return () => clearInterval(t);
    }, [bonusWachtTot]);

    function wisselLetters() {
        setGroteLetters((v) => {
            try { localStorage.setItem('vt_grote_letters', v ? '0' : '1'); } catch { /* */ }
            return !v;
        });
    }

    if (!sessie) return null;
    const mijnId = sessie.spelerId;
    const goed = resultaat?.status === 'goed';
    const aanBeurt = !ronde?.aanBeurtSpelers || ronde.aanBeurtSpelers.includes(mijnId);
    const vergrendeld = ingediend || goed || !aanBeurt || spel.gepauzeerd;
    // De live lobby-instelling is leidend (de host kan hints midden in een ronde
    // aan- of uitzetten); alleen als die ontbreekt telt de waarde uit de ronde.
    const hintsAan = typeof lobbyInstellingen?.hints_aan === 'boolean'
        ? lobbyInstellingen.hints_aan
        : ronde?.hintsAan !== false;

    function kies(i, optie) {
        if (vergrendeld) return;
        setGekozen(i);
        setIngediend(true);
        spel.gok(optie);
    }
    function typ(e) {
        e.preventDefault();
        if (!getypt.trim() || vergrendeld) return;
        setIngediend(true);
        spel.gok(getypt.trim());
    }

    const bonusKlaar = bonusResultaat?.status === 'goed' || bonusResultaat?.status === 'opgegeven';
    const bonusWacht = bonusWachtTot > Date.now();
    const bonusUit = bonusResultaat?.uitgeslotenIndexen || bonus?.uitgeslotenIndexen || [];

    const kop = (links, midden = null) => (
        <header className="kz-kop">
            <span className="kz-teller">{links}</span>
            <span className="kz-kop-midden">{midden}</span>
            <button type="button" className="kz-icoon" onClick={() => setMeerOpen(true)} aria-label="Meer opties">⋯</button>
        </header>
    );

    let inhoud = null;
    if (fase === 'raden' && ronde) {
        const melding = resultaat && !goed && resultaat.status !== 'goed'
            ? (resultaat.melding || (resultaat.status === 'bijna' ? 'Bijna! Ingestuurd.' : resultaat.status === 'fout' ? 'Helaas, mis.' : ''))
            : '';
        inhoud = (
            <>
                {kop(<>Vraag {ronde.rondenummer}<small>/{ronde.totaal || '∞'}</small></>,
                    ronde.durationMs && !spel.gepauzeerd
                        ? <span className="kz-klok"><Timer startTs={ronde.startTs} durationMs={ronde.durationMs} /></span>
                        : null)}
                {hostBalk}
                <section className="kz-vraag">
                    <h1>{ronde.vraag || 'Herken je deze muziek?'}</h1>
                    {hints.length > 0 && <ul className="kz-hints">{hints.map((h, i) => <li key={i}>{h.tekst}</li>)}</ul>}
                </section>
                <section className="kz-antwoorden">
                    {!aanBeurt ? (
                        <div className="kz-melding-groot">
                            <small>Beurt van {ronde.aanBeurtNaam || 'een andere speler'}</small>
                            <strong>{toeschouwerTitel?.naam || '…'}</strong>
                            <small>Jij ziet het antwoord: help met hints</small>
                        </div>
                    ) : goed ? (
                        <div className="kz-melding-groot kz-goed">
                            <strong>Goed!</strong><span>+{resultaat.punten}</span>
                        </div>
                    ) : antwoordOpties ? (
                        <Tegels opties={antwoordOpties} onKies={kies} uit={verwijderdeOpties} gekozen={gekozen}
                            fout={gekozen !== null && resultaat && !goed && ['fout', 'bijna'].includes(resultaat.status) ? [gekozen] : []}
                            vergrendeld={vergrendeld} />
                    ) : (
                        <form className="kz-typen" onSubmit={typ}>
                            <input className="invoer" value={getypt} onChange={(e) => setGetypt(e.target.value)}
                                placeholder="Typ je antwoord" aria-label="Jouw antwoord" autoComplete="off" disabled={vergrendeld} />
                            <button className="knop" type="submit" disabled={vergrendeld}>{ingediend ? 'Verstuurd' : 'Versturen'}</button>
                        </form>
                    )}
                </section>
                <footer className="kz-voet">
                    {melding ? <span className={'kz-feedback ' + (resultaat?.status || '')}>{melding}</span> : <span />}
                    {hintsAan && aanBeurt && !goed && (
                        <span className="kz-hulp">
                            <button type="button" className="kz-pil" onClick={spel.vraagHint}>Hint −25</button>
                            {antwoordOpties && (
                                <button type="button" className="kz-pil" onClick={spel.verwijder3}>
                                    −3 fout{spel.hulplijnen.verwijder3 !== null ? ` (${spel.hulplijnen.verwijder3})` : ''}
                                </button>
                            )}
                        </span>
                    )}
                </footer>
            </>
        );
    } else if (fase === 'onthul' && antwoord) {
        inhoud = (
            <>
                {kop('Het antwoord')}
                {hostBalk}
                <section className="kz-onthul">
                    {antwoord.poster && <img className="kz-poster" src={antwoord.poster} alt="" />}
                    <h1>{antwoord.naam}</h1>
                    <p className="kz-sub">{[antwoord.tracknaam && antwoord.tracknaam !== antwoord.naam ? antwoord.tracknaam : null, antwoord.artiest, jaarTekst(antwoord)].filter(Boolean).join(' · ')}</p>
                    {antwoord.bekendheid && <p className="kz-label">{TIER[antwoord.bekendheid]} · ×{antwoord.puntenFactor || 1}</p>}
                    {mijnUitslag && (
                        <p className={'kz-uitslag ' + (mijnUitslag.goed ? 'goed' : 'fout')}>
                            {mijnUitslag.goed ? `Jij had hem! +${mijnUitslag.punten}` : 'Deze keer niet'}
                        </p>
                    )}
                </section>
            </>
        );
    } else if (fase === 'bonus' && bonus) {
        inhoud = (
            <>
                {kop(<>Bonus<small> +50</small></>, antwoord ? <span className="kz-kop-titel">{antwoord.naam}</span> : null)}
                {hostBalk}
                <section className="kz-vraag"><h1>{bonus.vraag}</h1></section>
                <section className="kz-antwoorden">
                    <Tegels opties={bonus.opties} gekozen={bonusKeuze} uit={[]} fout={bonusUit}
                        juist={bonusResultaat?.status === 'goed' ? bonusResultaat.correctIndex : null}
                        vergrendeld={bonusKlaar || bonusWacht}
                        onKies={(i) => {
                            if (bonusKlaar || bonusWacht || bonusUit.includes(i)) return;
                            setBonusKeuze(i);
                            spel.bonusAntwoord(i);
                        }} />
                </section>
                <footer className="kz-voet">
                    <span className={'kz-feedback ' + (bonusResultaat?.status || '')}>
                        {bonusResultaat?.status === 'goed' && `Goed! +${bonusResultaat.punten}`}
                        {bonusResultaat?.status === 'optie-weg' && 'Die optie is weg.'}
                        {['fout', 'nogmaals', 'wachten'].includes(bonusResultaat?.status) && `Mis. Nog ${Math.ceil(Math.max(0, bonusWachtTot - Date.now()) / 1000)}s wachten.`}
                        {bonusResultaat?.status === 'opgegeven' && 'Opgegeven.'}
                    </span>
                    {!bonusKlaar && <button type="button" className="kz-pil" onClick={spel.bonusOpgeven}>Ik weet het niet</button>}
                </footer>
            </>
        );
    } else if (fase === 'scorebord') {
        const koths = ['king_of_the_hill', 'bergexpeditie'].includes(lobbyInstellingen?.spelvorm);
        inhoud = (
            <>
                {kop(<>Na vraag {ronde?.rondenummer || ''}<small>/{ronde?.totaal || '∞'}</small></>)}
                {hostBalk}
                <AntwoordKaart antwoord={antwoord} uitslag={mijnUitslag} />
                <section className="kz-score">
                    <h2>Tussenstand</h2>
                    {koths ? <KingOfTheHill koth={koth} instellingen={lobbyInstellingen} scorebord={scorebord} mijnId={mijnId} />
                        : <Stand lijst={scorebord} mijnId={mijnId} />}
                </section>
                {!hostBalk && ronde?.aanBeurtSpelers?.includes(mijnId) && (
                    <footer className="kz-voet"><button className="knop" type="button" onClick={spel.volgende}>Volgende ronde</button></footer>
                )}
            </>
        );
    } else if (fase === 'einde') {
        inhoud = (
            <>
                {kop('Eindstand')}
                <section className="kz-score">
                    <Stand lijst={scorebord} mijnId={mijnId} max={8} eind />
                </section>
                <footer className="kz-voet"><button className="knop" type="button" onClick={onVerlaten}>{hostBalk ? 'Nieuw spel' : 'Terug naar start'}</button></footer>
            </>
        );
    } else {
        inhoud = (
            <>
                {kop('VenTune')}
                {hostBalk}
                <section className="kz-melding-groot"><strong>Even geduld…</strong></section>
            </>
        );
    }

    return (
        <main className={'kz' + (groteLetters ? ' kz-groot' : '') + (spel.gepauzeerd ? ' kz-gepauzeerd' : '')}>
            {(!spel.verbonden || spel.herstelNodig) && (
                <div className="kz-balk-melding" role="status">
                    <span>{spel.verbonden ? 'Ronde reageert niet' : 'Verbinding weg'}</span>
                    <button type="button" className="kz-pil" onClick={spel.herstelSpel} disabled={spel.herstelBezig}>
                        {spel.herstelBezig ? 'Bezig…' : 'Herstellen'}
                    </button>
                </div>
            )}
            {spel.fout && <div className="kz-balk-melding fout" role="alert"><span>{spel.fout}</span>
                <button type="button" className="kz-icoon" onClick={spel.wisFout} aria-label="Sluiten">×</button></div>}
            {inhoud}
            {spel.gepauzeerd && fase === 'raden' && <div className="kz-pauze" aria-live="polite"><span>Pauze</span></div>}
            {meerOpen && <MeerPaneel spel={spel} onSluit={() => setMeerOpen(false)} groteLetters={groteLetters}
                onLetters={wisselLetters} onVerlaten={onVerlaten} />}
        </main>
    );
}
