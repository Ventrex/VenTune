import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    maakLobby,
    haalTelling,
    haalPresets,
    haalCollecties,
    haalQuizzen,
    bewaarPreset,
    verwijderPreset,
    authSessie,
    authUitloggen,
} from '../lib/api.js';
import { bewaarSessie } from '../lib/sessie.js';
import Brand from '../components/Brand.jsx';

const NU = new Date().getFullYear();

const CATEGORIEEN = [
    { waarde: 'beide', label: 'Films & Series', logo: '/logos/films-series.svg', uitleg: 'Hitster voor intro’s, themes en soundtracks' },
    { waarde: 'films', label: 'Films', logo: '/logos/films.svg', uitleg: 'Alleen films' },
    { waarde: 'series', label: 'Series', logo: '/logos/series.svg', uitleg: 'Alleen series' },
    { waarde: 'muziek', label: 'Muziek', logo: '/logos/music.svg', uitleg: 'Muziekedities later uitbreiden' },
];
const TALEN = [
    { waarde: 'nl', label: 'Nederlands', icoon: '🇳🇱' },
    { waarde: 'en', label: 'Internationaal', icoon: '🌍' },
    { waarde: 'us', label: 'Amerikaans', icoon: '🇺🇸' },
    { waarde: 'beide', label: 'Alle talen', icoon: '✨' },
];
const LEEFTIJDEN = [
    { waarde: 0, label: 'Alle leeftijden', uitleg: 'Volledige gecureerde catalogus' },
    { waarde: 6, label: '6+', uitleg: 'Geschikt vanaf 6 jaar' },
    { waarde: 9, label: '9+', uitleg: 'Geschikt vanaf 9 jaar' },
    { waarde: 12, label: '12+', uitleg: 'Geschikt vanaf 12 jaar' },
    { waarde: 16, label: '16+', uitleg: 'Geschikt vanaf 16 jaar' },
    { waarde: 18, label: '18+', uitleg: 'Volledige leeftijdsgrens' },
];
const RONDES = [
    { waarde: 10, label: '10' },
    { waarde: 20, label: '20' },
    { waarde: 30, label: '30' },
    { waarde: 0, label: 'Eindeloos' },
];
// Bekendheid: hoeveel TMDB-stemmen een titel minimaal moet hebben.
const BEKENDHEID = [
    { waarde: 0, label: 'Bekend / gecureerd' },
    { waarde: 25, label: 'Bekend' },
    { waarde: 200, label: 'Bekend' },
    { waarde: 1000, label: 'Heel bekend' },
    { waarde: 4000, label: 'Iconisch' },
];
// Genres die je kunt uitzetten (standaard staat alles aan).
const GENRES = [
    'Actie', 'Avontuur', 'Animatie', 'Komedie', 'Misdaad', 'Documentaire',
    'Drama', 'Familie', 'Fantasy', 'Historisch', 'Horror', 'Musical',
    'Mysterie', 'Romantiek', 'Sciencefiction', 'Thriller', 'Oorlog',
    'Western', 'Kerst', 'Superhelden', 'Sport', 'Realityshow',
];
const MODI = [
    { waarde: 'snelste', label: 'Snelste', uitleg: 'Eerste goede antwoord wint de ronde' },
    { waarde: 'kenner', label: 'Kenner', uitleg: 'Iedereen raadt door tot jij verder klikt' },
];
const ANTWOORD_MODI = [
    { waarde: 'typen', label: 'Typen', uitleg: 'Spelers vullen zelf de titel in' },
    { waarde: 'meerkeuze', label: '6 opties', uitleg: 'Zes antwoorden met hulplijn' },
];
const SPEELTIJDEN = [
    { waarde: 0, label: 'Heel nummer' },
    { waarde: 30, label: '30 sec' },
    { waarde: 60, label: '1 min' },
    { waarde: 90, label: '1½ min' },
];
const PERIODE_SNEL = [
    { label: 'Alles', van: 1930, tot: NU },
    { label: 'Jaren 80', van: 1980, tot: 1989 },
    { label: 'Jaren 90', van: 1990, tot: 1999 },
    { label: '2000–2010', van: 2000, tot: 2010 },
    { label: '2010–2020', van: 2010, tot: 2020 },
    { label: '2020–nu', van: 2020, tot: NU },
];

// Het filtermenu: vier volledige schermen met grote tapdoelen.
export default function Setup() {
    const navigate = useNavigate();
    // Stap 0 is de editiekeuze: kies een kant-en-klare quiz, of stel zelf in.
    const [stap, setStap] = useState(0);
    const [quizzen, setQuizzen] = useState([]);
    const [quizSleutel, setQuizSleutel] = useState(null);
    const [filters, setFilters] = useState({
        categorie: 'beide',
        categorieen: ['film', 'serie'],
        collecties: [],
        taal: 'beide',
        periode_start: 1930,
        periode_eind: NU,
        rondes: 10,
        speeltijd: 0,
        modus: 'snelste',
        antwoord_modus: 'meerkeuze',
        min_bekendheid: 0,
        zonder_genres: [],
        leeftijd_max: 0,
        kindvriendelijk: false,
        leeftijd_deelnemer_min: 4,
        leeftijd_deelnemer_max: 99,
        alleen_nl_tv: true,
        alleen_gecontroleerd: false,
        leeftijdspunten_aan: false,
        leeftijdsfactoren: { 6: 2, 9: 1.75, 12: 1.5, 16: 1.25, 18: 1 },
    });
    const [telling, setTelling] = useState(null);
    const [presets, setPresets] = useState([]);
    const [presetNaam, setPresetNaam] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    const [host, setHost] = useState(null);
    const [collecties, setCollecties] = useState([]);
    const [tellingFout, setTellingFout] = useState('');

    // Ook bij rechtstreeks openen van /setup blijft de hostaccount verplicht.
    useEffect(() => {
        authSessie().then((s) => {
            if (!s.ingelogd) navigate('/host/login?return=/setup', { replace: true });
            else setHost(s.gebruiker);
        }).catch(() => navigate('/host/login?return=/setup', { replace: true }));
    }, [navigate]);

    // Presets laden bij binnenkomst.
    useEffect(() => {
        haalPresets().then(setPresets).catch(() => {});
        haalCollecties().then(setCollecties).catch(() => {});
        haalQuizzen().then(setQuizzen).catch(() => {});
    }, []);

    /**
     * Een editie kiezen: de filters van die quiz overnemen en doorgaan naar
     * de spelinstellingen. Alles blijft daarna aanpasbaar, dus de quiz is
     * een startpunt en geen keurslijf.
     */
    function kiesQuiz(quiz) {
        const f = quiz.filter || {};
        const categorieen = f.categorieen || ['film', 'serie'];
        setQuizSleutel(quiz.sleutel);
        setFilters((oud) => ({
            ...oud,
            categorieen,
            categorie: categorieen.length === 1
                ? ({ film: 'films', serie: 'series', muziek: 'muziek' })[categorieen[0]]
                : 'beide',
            collecties: f.collecties || [],
            met_genres: f.met_genres || [],
            studios: f.studios || [],
            taal: f.taal || 'beide',
            periode_start: f.periode_start ?? 1930,
            periode_eind: f.periode_eind ?? NU,
            kindvriendelijk: f.kindvriendelijk === true,
            leeftijd_max: f.leeftijd_max ?? 0,
            zonder_genres: f.zonder_genres || [],
        }));
        // De editie bepaalt al type, taal, periode en collectie. Alleen het
        // aantal rondes staat nog open, dus daar gaan we meteen heen. Met
        // Terug kom je alsnog bij de losse filters.
        setStap(4);
    }

    // Live telling ophalen wanneer de filters veranderen.
    const ververTelling = useCallback(() => {
        setTellingFout('');
        haalTelling(filters)
            .then((nieuw) => {
                setTelling(nieuw);
                setTellingFout('');
            })
            .catch((err) => {
                setTelling(null);
                setTellingFout(err.message || 'Kon de beschikbare titels niet tellen.');
            });
    }, [filters]);

    useEffect(() => {
        ververTelling();
    }, [ververTelling]);

    const gekozenQuiz = quizzen.find((q) => q.sleutel === quizSleutel) || null;

    // Filters die bepálen wát er gespeeld wordt. Pas je daar één van aan, dan
    // klopt de naam van de gekozen editie niet meer. Rondes, speeltijd en
    // antwoordwijze veranderen de inhoud niet en laten de naam dus staan.
    const INHOUDSFILTERS = new Set([
        'categorie', 'categorieen', 'collecties', 'met_genres', 'studios',
        'taal', 'periode_start', 'periode_eind', 'zonder_genres',
        'kindvriendelijk', 'leeftijd_max',
    ]);

    function zet(sleutel, waarde) {
        if (INHOUDSFILTERS.has(sleutel)) setQuizSleutel(null);
        setFilters((f) => ({ ...f, [sleutel]: waarde }));
    }

    // Genre aan/uit zetten. Uitgezette genres komen in zonder_genres.
    function wisselGenre(genre) {
        setFilters((f) => {
            const uit = f.zonder_genres || [];
            return {
                ...f,
                zonder_genres: uit.includes(genre)
                    ? uit.filter((g) => g !== genre)
                    : [...uit, genre],
            };
        });
    }

    function zetPeriode(van, tot) {
        setFilters((f) => ({ ...f, periode_start: van, periode_eind: tot }));
    }

    // Sliders: houd van ≤ tot.
    function zetVan(v) {
        const van = Math.min(v, filters.periode_eind);
        zet('periode_start', van);
    }
    function zetTot(v) {
        const tot = Math.max(v, filters.periode_start);
        zet('periode_eind', tot);
    }

    function wijzigDeelnemerLeeftijd(sleutel, waarde) {
        // Laat tijdelijk leegmaken toe. De oude Math.max(... || 4)-logica
        // zette direct opnieuw een 4 terug, waardoor 10/410 typen onmogelijk
        // werd op mobiel en desktop.
        setFilters((f) => ({ ...f, [sleutel]: waarde }));
    }

    function normaliseerDeelnemerLeeftijden() {
        setFilters((f) => {
            const jongsteGetal = Number(f.leeftijd_deelnemer_min);
            const jongste = Number.isFinite(jongsteGetal)
                ? Math.min(120, Math.max(4, jongsteGetal)) : 4;
            const oudsteGetal = Number(f.leeftijd_deelnemer_max);
            const oudste = Number.isFinite(oudsteGetal)
                ? Math.min(120, Math.max(jongste, oudsteGetal)) : Math.max(jongste, 99);
            return {
                ...f,
                leeftijd_deelnemer_min: jongste,
                leeftijd_deelnemer_max: oudste,
            };
        });
    }

    function instellingenMetLeeftijden(basis = filters) {
        const jongsteGetal = Number(basis.leeftijd_deelnemer_min);
        const jongste = Number.isFinite(jongsteGetal)
            ? Math.min(120, Math.max(4, jongsteGetal)) : 4;
        const oudsteGetal = Number(basis.leeftijd_deelnemer_max);
        const oudste = Number.isFinite(oudsteGetal)
            ? Math.min(120, Math.max(jongste, oudsteGetal)) : Math.max(jongste, 99);
        return {
            ...basis,
            leeftijd_deelnemer_min: jongste,
            leeftijd_deelnemer_max: oudste,
        };
    }

    function wisselCollectie(collectie) {
        setFilters((f) => {
            const huidig = f.collecties || [];
            const gekozen = huidig.includes(collectie.sleutel)
                ? huidig.filter((x) => x !== collectie.sleutel)
                : [...huidig, collectie.sleutel];
            const volgende = { ...f, collecties: gekozen };
            // Een editie is een extra label, geen typewissel. Zo blijft een
            // Disney-film ook gewoon een film en voeg je niet per ongeluk
            // muziek toe aan een Films & Series-spel.
            if (collectie.sleutel === 'streaming' && gekozen.includes('streaming')) volgende.alleen_nl_tv = false;
            return volgende;
        });
    }

    async function opslaanPreset() {
        if (!presetNaam.trim()) return;
        try {
            const nieuw = await bewaarPreset({ naam: presetNaam.trim(), ...instellingenMetLeeftijden() });
            setPresets((p) => [nieuw, ...p]);
            setPresetNaam('');
        } catch (err) {
            setFout(err.message);
        }
    }

    function pasPresetToe(p) {
        setFilters({
            categorie: p.categorie || 'beide',
            categorieen: p.categorieen || (p.categorie === 'films' ? ['film'] : p.categorie === 'series' ? ['serie'] : ['film', 'serie']),
            collecties: p.collecties || [],
            taal: p.taal,
            periode_start: p.periode_start,
            periode_eind: p.periode_eind,
            rondes: p.rondes,
            speeltijd: p.speeltijd ?? 0,
            modus: p.modus || 'snelste',
            antwoord_modus: p.antwoord_modus || 'meerkeuze',
            min_bekendheid: p.min_bekendheid ?? 0,
            zonder_genres: p.zonder_genres || [],
            leeftijd_max: p.leeftijd_max ?? 0,
            kindvriendelijk: p.kindvriendelijk === true,
            leeftijd_deelnemer_min: p.leeftijd_deelnemer_min ?? 4,
            leeftijd_deelnemer_max: p.leeftijd_deelnemer_max ?? 99,
            alleen_nl_tv: p.alleen_nl_tv !== false,
            alleen_gecontroleerd: p.alleen_gecontroleerd === true,
            leeftijdspunten_aan: p.leeftijdspunten_aan === true,
            leeftijdsfactoren: p.leeftijdsfactoren || { 6: 2, 9: 1.75, 12: 1.5, 16: 1.25, 18: 1 },
        });
        setStap(4);
    }

    async function verwijder(id) {
        await verwijderPreset(id);
        setPresets((p) => p.filter((x) => x.id !== id));
    }

    async function start() {
        if (!telling || !telling.genoeg) return;
        setBezig(true);
        setFout('');
        try {
            const lobby = await maakLobby(instellingenMetLeeftijden());
            bewaarSessie({
                token: lobby.token,
                code: lobby.code,
                spelerId: lobby.spelerId,
                is_host: true,
            });
            navigate('/host');
        } catch (err) {
            setFout(err.message);
            setBezig(false);
        }
    }

    const terug = () => (stap > 0 ? setStap(stap - 1) : navigate('/'));
    const verder = () => setStap(Math.min(stap + 1, 4));

    return (
        <main className="scherm">
            <Brand compact />
            {host && (
                <div className="account-balk">
                    Host: <strong>{host.display_naam}</strong>
                    <button
                        className="terug als-link"
                        type="button"
                        onClick={() => navigate('/host/profile')}
                    >
                        Profiel
                    </button>
                    <button
                        className="terug als-link"
                        type="button"
                        onClick={async () => { await authUitloggen(); navigate('/'); }}
                    >
                        Uitloggen
                    </button>
                </div>
            )}
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <button className="terug als-link" onClick={terug}>
                    ← Terug
                </button>
            </p>

            {/* Voortgang */}
            <div className="stappen">
                {[0, 1, 2, 3, 4].map((n) => (
                    <span
                        key={n}
                        className={'stap-bol' + (n <= stap ? ' actief' : '')}
                    />
                ))}
            </div>

            {fout && <p className="waarschuwing">{fout}</p>}

            {/* Stap 0: welke quiz spelen we? */}
            {stap === 0 && (
                <section>
                    <h1>Welke quiz?</h1>
                    <p className="dim">
                        Kies een kant-en-klare editie. Je kunt daarna nog alles
                        aanpassen.
                    </p>
                    {quizzen.length === 0 && (
                        <p className="dim">Edities worden geladen…</p>
                    )}
                    <div className="quiz-grid">
                        {quizzen.map((q) => (
                            <button
                                key={q.sleutel}
                                type="button"
                                className={
                                    'quiz-kaart' +
                                    (quizSleutel === q.sleutel ? ' gekozen' : '') +
                                    (q.klaar ? '' : ' leeg')
                                }
                                onClick={() => kiesQuiz(q)}
                                disabled={q.speelbaar === 0}
                            >
                                <span className="quiz-emoji" aria-hidden="true">{q.emoji || '🎵'}</span>
                                <span className="quiz-naam">{q.naam}</span>
                                <span className="quiz-aantal">
                                    {q.speelbaar === 0
                                        ? 'nog geen muziek'
                                        : `${q.speelbaar} ${q.speelbaar === 1 ? 'titel' : 'titels'}`}
                                </span>
                            </button>
                        ))}
                    </div>
                    <button
                        className="knop knop-stil"
                        type="button"
                        style={{ marginTop: '1rem' }}
                        onClick={() => { setQuizSleutel(null); setStap(1); }}
                    >
                        Zelf instellen
                    </button>
                </section>
            )}

            {/* Stap 1: Gamekeuze */}
            {stap === 1 && (
                <section>
                    <h1>Welke game?</h1>
                    <div className="keuzes setup-logo-grid">
                        {CATEGORIEEN.map((c) => (
                            <button
                                key={c.waarde}
                                className={
                                    'keuze' +
                                    (filters.categorie === c.waarde ? ' gekozen' : '')
                                }
                                onClick={() => {
                                    zet('categorie', c.waarde);
                                    zet('categorieen', c.waarde === 'films'
                                        ? ['film']
                                        : c.waarde === 'series'
                                          ? ['serie']
                                          : c.waarde === 'muziek'
                                            ? ['muziek']
                                            : ['film', 'serie']);
                                    verder();
                                }}
                            >
                                <img className="keuze-logo-img" src={c.logo} alt="" />
                                <span>{c.label}</span>
                                <span className="keuze-uitleg">{c.uitleg}</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* Stap 2: Taal/regio */}
            {stap === 2 && (
                <section>
                    <h1>Taal</h1>
                    <div className="keuzes setup-logo-grid">
                        {TALEN.map((t) => (
                            <button
                                key={t.waarde}
                                className={
                                    'keuze' +
                                    (filters.taal === t.waarde ? ' gekozen' : '')
                                }
                                onClick={() => {
                                    zet('taal', t.waarde);
                                    verder();
                                }}
                            >
                                <span className="keuze-logo">{t.icoon}</span>
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* Stap 3: Periode */}
            {stap === 3 && (
                <section>
                    <h1>Editie & periode</h1>
                    {collecties.length > 0 && (
                        <>
                            <p className="kaart-label" style={{ textAlign: 'left' }}>
                                Editie / collectie
                            </p>
                            <div className="chips">
                                <button
                                    type="button"
                                    className={'chip' + (!(filters.collecties || []).length ? ' gekozen' : '')}
                                    onClick={() => zet('collecties', [])}
                                >
                                    Algemeen
                                </button>
                                {collecties.map((c) => (
                                    <button
                                        key={c.sleutel}
                                        type="button"
                                        className={'chip' + ((filters.collecties || []).includes(c.sleutel) ? ' gekozen' : '')}
                                        onClick={() => wisselCollectie(c)}
                                    >
                                        {c.naam} <span className="dim">({c.aantal})</span>
                                    </button>
                                ))}
                            </div>
                            <p className="dim" style={{ marginTop: '0.5rem' }}>
                                Meerdere keuzes kan. Een titel kan bijvoorbeeld Film én Disney/Pixar zijn.
                            </p>
                        </>
                    )}
                    <p className="periode-waarde">
                        {filters.periode_start} – {filters.periode_eind}
                    </p>

                    <label className="kaart-label" style={{ textAlign: 'left' }}>
                        Van {filters.periode_start}
                    </label>
                    <input
                        className="schuif"
                        type="range"
                        min={1930}
                        max={NU}
                        value={filters.periode_start}
                        onChange={(e) => zetVan(Number(e.target.value))}
                        aria-label="Van jaar"
                    />
                    <label className="kaart-label" style={{ textAlign: 'left' }}>
                        Tot {filters.periode_eind}
                    </label>
                    <input
                        className="schuif"
                        type="range"
                        min={1930}
                        max={NU}
                        value={filters.periode_eind}
                        onChange={(e) => zetTot(Number(e.target.value))}
                        aria-label="Tot jaar"
                    />

                    <div className="chips" style={{ marginTop: '1rem' }}>
                        {PERIODE_SNEL.map((p) => (
                            <button
                                key={p.label}
                                className={
                                    'chip' +
                                    (filters.periode_start === p.van &&
                                    filters.periode_eind === p.tot
                                        ? ' gekozen'
                                        : '')
                                }
                                onClick={() => zetPeriode(p.van, p.tot)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <button
                        className="knop"
                        style={{ marginTop: '1.5rem', width: '100%' }}
                        onClick={verder}
                    >
                        Verder
                    </button>
                </section>
            )}

            {/* Stap 4: Rondes + telling + presets + start */}
            {stap === 4 && (
                <section>
                    <h1>Rondes</h1>
                    <div className="keuzes">
                        {RONDES.map((r) => (
                            <button
                                key={r.waarde}
                                className={
                                    'keuze' +
                                    (filters.rondes === r.waarde ? ' gekozen' : '')
                                }
                                onClick={() => zet('rondes', r.waarde)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    {/* Bekendheid */}
                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Hoe bekend moeten de titels zijn?
                    </p>
                    <div className="chips">
                        {BEKENDHEID.map((b) => (
                            <button
                                key={b.waarde}
                                className={
                                    'chip' +
                                    (filters.min_bekendheid === b.waarde ? ' gekozen' : '')
                                }
                                onClick={() => zet('min_bekendheid', b.waarde)}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>

                    {/* Genres uitklikken */}
                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Genres — tik aan om uit te sluiten
                        {(filters.zonder_genres || []).length > 0 &&
                            ` (${filters.zonder_genres.length} uit)`}
                    </p>
                    <div className="chips">
                        {GENRES.map((g) => {
                            const uit = (filters.zonder_genres || []).includes(g);
                            return (
                                <button
                                    key={g}
                                    className={'chip' + (uit ? ' uitgezet' : ' gekozen')}
                                    onClick={() => wisselGenre(g)}
                                >
                                    {uit ? `✕ ${g}` : g}
                                </button>
                            );
                        })}
                    </div>

                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Leeftijd
                    </p>
                    <div className="keuzes">
                        {LEEFTIJDEN.map((l) => (
                            <button
                                key={l.waarde}
                                className={'keuze klein' + (filters.leeftijd_max === l.waarde ? ' gekozen' : '')}
                                onClick={() => zet('leeftijd_max', l.waarde)}
                            >
                                <span>{l.label}</span>
                                <span className="keuze-uitleg">{l.uitleg}</span>
                            </button>
                        ))}
                    </div>

                    <label className="keuze klein keuze-schakelaar" style={{ marginTop: '1rem' }}>
                        <input
                            type="checkbox"
                            checked={filters.alleen_nl_tv !== false}
                            onChange={(e) => zet('alleen_nl_tv', e.target.checked)}
                        />
                        <span>
                            <strong>Alleen titels die op Nederlandse tv te zien waren</strong>
                            <span className="keuze-uitleg">Nieuwe/importtitels blijven verborgen tot de admin ze goedkeurt</span>
                        </span>
                    </label>

                    <label className="keuze klein keuze-schakelaar" style={{ marginTop: '1rem' }}>
                        <input
                            type="checkbox"
                            checked={filters.alleen_gecontroleerd === true}
                            onChange={(e) => zet('alleen_gecontroleerd', e.target.checked)}
                        />
                        <span>
                            <strong>Alleen gecontroleerde nummers</strong>
                            <span className="keuze-uitleg">Gebruik alleen tracks met een betrouwbare controle of admin-goedkeuring</span>
                        </span>
                    </label>

                    <label className="keuze klein keuze-schakelaar" style={{ marginTop: '1rem' }}>
                        <input
                            type="checkbox"
                            checked={filters.leeftijdspunten_aan === true}
                            onChange={(e) => zet('leeftijdspunten_aan', e.target.checked)}
                        />
                        <span>
                            <strong>Leeftijdsbonus aan</strong>
                            <span className="keuze-uitleg">Kinderen krijgen meer punten: t/m 6 ×2, t/m 9 ×1,75, t/m 12 ×1,5</span>
                        </span>
                    </label>
                    {filters.leeftijdspunten_aan === true && (
                        <label className="velden compact-veld" style={{ marginTop: '0.5rem' }}>
                            <span className="kaart-label" style={{ textAlign: 'left' }}>Schema leeftijdsbonus</span>
                            <select
                                className="invoer"
                                value={String(filters.leeftijdsfactoren?.[6] || 2)}
                                onChange={(e) => {
                                    const royaal = Number(e.target.value) >= 2;
                                    zet('leeftijdsfactoren', royaal
                                        ? { 6: 2, 9: 1.75, 12: 1.5, 16: 1.25, 18: 1 }
                                        : { 6: 1.5, 9: 1.35, 12: 1.2, 16: 1.1, 18: 1 });
                                }}
                            >
                                <option value="2">Royaal: ×2 / ×1,75 / ×1,5</option>
                                <option value="1.5">Mild: ×1,5 / ×1,35 / ×1,2</option>
                            </select>
                        </label>
                    )}

                    <label className="keuze klein keuze-schakelaar" style={{ marginTop: '1rem' }}>
                        <input
                            type="checkbox"
                            checked={filters.kindvriendelijk === true}
                            onChange={(e) => setFilters((f) => ({
                                ...f,
                                kindvriendelijk: e.target.checked,
                                leeftijd_max: e.target.checked ? Math.min(Number(f.leeftijd_max) || 12, 12) : f.leeftijd_max,
                            }))}
                        />
                        <span>
                            <strong>Kindvriendelijke editie</strong>
                            <span className="keuze-uitleg">Alleen kindvriendelijke familie-, animatie-, avontuur- en comedy-inhoud tot en met 12+; 200 punten en 20 seconden leestijd.</span>
                        </span>
                    </label>

                    {/* Spelsoort */}
                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Spelsoort
                    </p>
                    <div className="keuzes">
                        {MODI.map((m) => (
                            <button
                                key={m.waarde}
                                className={
                                    'keuze klein' +
                                    (filters.modus === m.waarde ? ' gekozen' : '')
                                }
                                onClick={() => zet('modus', m.waarde)}
                            >
                                <span>{m.label}</span>
                                <span className="keuze-uitleg">{m.uitleg}</span>
                            </button>
                        ))}
                    </div>

                    {/* Antwoordwijze */}
                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Antwoordwijze
                    </p>
                    <div className="keuzes">
                        {ANTWOORD_MODI.map((m) => (
                            <button
                                key={m.waarde}
                                className={
                                    'keuze klein' +
                                    (filters.antwoord_modus === m.waarde ? ' gekozen' : '')
                                }
                                onClick={() => zet('antwoord_modus', m.waarde)}
                            >
                                <span>{m.label}</span>
                                <span className="keuze-uitleg">{m.uitleg}</span>
                            </button>
                        ))}
                    </div>

                    {/* Speeltijd per ronde */}
                    <p
                        className="kaart-label"
                        style={{ textAlign: 'left', marginTop: '1.5rem' }}
                    >
                        Speeltijd per ronde
                    </p>
                    <div className="chips">
                        {SPEELTIJDEN.map((s) => (
                            <button
                                key={s.waarde}
                                className={
                                    'chip' + (filters.speeltijd === s.waarde ? ' gekozen' : '')
                                }
                                onClick={() => zet('speeltijd', s.waarde)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* Live telling */}
                    <div className="telling">
                        {tellingFout ? (
                            <p className="waarschuwing">
                                {tellingFout}{' '}
                                <button className="afspeelknop klein" type="button" onClick={ververTelling}>Opnieuw proberen</button>
                            </p>
                        ) : telling ? (
                            telling.genoeg ? (
                                <p className="dim">
                                    {telling.titels} speelbare titels beschikbaar met deze filters.
                                    {telling.catalogus > telling.titels && ` (${telling.catalogus} titels in de catalogus; tracks ontbreken nog bij ${telling.catalogus - telling.titels})`}
                                    {telling.minder_dan_gevraagd && ` Het spel speelt ${telling.titels} ronde${telling.titels === 1 ? '' : 's'} met deze selectie.`}
                                </p>
                            ) : (
                                <p className="waarschuwing">
                                    Slechts {telling.titels} speelbare titels — je hebt er minstens{' '}
                                    {telling.drempel} nodig. Verruim de filters of voeg
                                    meer nummers toe.
                                    {telling.catalogus > telling.titels && ` De filter bevat ${telling.catalogus} titels, maar ${telling.catalogus - telling.titels} daarvan heeft nog geen werkende track.`}
                                </p>
                            )
                        ) : (
                            <p className="dim">Beschikbare titels tellen…</p>
                        )}
                    </div>

                    <div className="kaart setup-samenvatting" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <p className="kaart-label">Jouw spel</p>
                        <p style={{ margin: 0 }}>
                            {/* Is er een editie gekozen, dan is dát de naam van
                                het spel; de losse filters staan eronder. */}
                            <strong>
                                {gekozenQuiz
                                    ? `${gekozenQuiz.emoji || ''} ${gekozenQuiz.naam}`.trim()
                                    : (filters.categorie === 'beide' ? 'Films & Series' : filters.categorie === 'films' ? 'Films' : filters.categorie === 'series' ? 'Series' : 'Muziek')}
                            </strong>
                            {' · '}{filters.periode_start}–{filters.periode_eind}
                            {' · '}{filters.rondes === 0 ? 'eindeloos' : `${filters.rondes} rondes`}
                        </p>
                        <p className="dim" style={{ marginBottom: 0 }}>
                            {filters.antwoord_modus === 'meerkeuze' ? '6 antwoordopties' : 'zelf typen'}
                            {' · '}{filters.speeltijd === 0 ? 'heel nummer' : `${filters.speeltijd} seconden`}
                            {filters.kindvriendelijk === true ? ' · kindvriendelijk: 200 punten / 20 seconden' : ''}
                        </p>
                    </div>

                    <button
                        className="knop"
                        style={{ width: '100%' }}
                        onClick={start}
                        disabled={bezig || !telling || !telling.genoeg}
                    >
                        {bezig ? 'Lobby maken…' : 'Start spel'}
                    </button>

                    {/* Preset opslaan */}
                    <div className="zoekbalk" style={{ marginTop: '1.5rem' }}>
                        <input
                            className="invoer"
                            value={presetNaam}
                            onChange={(e) => setPresetNaam(e.target.value)}
                            placeholder="Bewaar als preset…"
                            maxLength={40}
                            aria-label="Presetnaam"
                        />
                        <button
                            className="knop knop-stil"
                            onClick={opslaanPreset}
                            disabled={!presetNaam.trim()}
                        >
                            Opslaan
                        </button>
                    </div>

                    {/* Opgeslagen presets */}
                    {presets.length > 0 && (
                        <div className="stapel" style={{ marginTop: '1rem' }}>
                            <p className="kaart-label" style={{ textAlign: 'left' }}>
                                Opgeslagen presets
                            </p>
                            {presets.map((p) => (
                                <div key={p.id} className="preset-rij">
                                    <button
                                        className="preset-knop"
                                        onClick={() => pasPresetToe(p)}
                                    >
                                        <span className="speler-naam">{p.naam}</span>
                                        <span className="dim">
                                            {labelVoor(p)}
                                        </span>
                                    </button>
                                    <button
                                        className="afspeelknop klein"
                                        onClick={() => verwijder(p.id)}
                                        aria-label="Verwijderen"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/muziek">
                    Muziek zoeken (test) →
                </Link>
            </p>
        </main>
    );
}

// Korte samenvatting van een preset voor in de lijst.
function labelVoor(p) {
    const cat =
        p.categorie === 'films'
            ? 'Films'
            : p.categorie === 'series'
              ? 'Series'
              : p.categorie === 'muziek'
                ? 'Muziek'
                : p.categorie === 'alles'
                  ? 'Alles'
              : 'Beide';
    const taal = p.taal === 'nl' ? 'NL' : p.taal === 'us' ? 'Amerikaans' : p.taal === 'en' ? 'Int' : 'NL+Int';
    const rondes = p.rondes === 0 ? 'eindeloos' : `${p.rondes} rondes`;
    const tijd = p.speeltijd === 0 ? 'heel nummer' : `${p.speeltijd}s`;
    const antwoord = p.antwoord_modus === 'meerkeuze' ? '6 opties' : 'typen';
    const leeftijd = p.leeftijd_max ? `t/m ${p.leeftijd_max}` : 'alle leeftijden';
    const tv = p.alleen_nl_tv === false ? 'alle catalogus' : 'NL-tv';
    const controle = p.alleen_gecontroleerd === true ? ' · alleen gecontroleerd' : '';
    const collecties = (p.collecties || []).length ? ` · ${p.collecties.join(', ')}` : '';
    const kind = p.kindvriendelijk === true ? ' · kindvriendelijk' : '';
    return `${cat}${collecties} · ${taal} · ${p.periode_start}–${p.periode_eind} · ${rondes} · ${tijd} · ${antwoord} · ${leeftijd} · ${tv}${controle}${kind}`;
}
