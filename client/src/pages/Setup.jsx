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
import ThemaKiezer from '../components/ThemaKiezer.jsx';
import UiterlijkOpties from '../components/UiterlijkOpties.jsx';
import './setup-categorie.css';

const NU = new Date().getFullYear();
const VASTE_BEELDEN = { "80s": 1, "90s": 1, animatie: 1, kinder: 1, kerst: 1, alles: 1 };

/** Leesbare naam van wat er gespeeld wordt, ook voor videogames en anime. */
function spelNaam(f) {
    const cats = f.categorieen || [];
    if (f.game_only === true || f.categorie === 'games' || (cats.length === 1 && cats[0] === 'game')) return 'Videogames';
    if (f.categorie === 'anime' || (cats.length === 1 && cats[0] === 'anime')) return 'Anime';
    if (f.categorie === 'films') return 'Films';
    if (f.categorie === 'series') return 'Series';
    if (f.categorie === 'muziek' || (cats.length === 1 && cats[0] === 'muziek')) return 'Muziek';
    return 'Films & Series';
}

// Bekendheid in de spelkeuze. "De rest" bundelt onbekend en cult.
const ALLE_TIERS = ['iconisch', 'algemeen_bekend', 'bekend', 'onbekend', 'cult'];
const STANDAARD_TIERS = ['iconisch', 'algemeen_bekend', 'bekend'];
const TIER_KEUZES = [
    { id: 'iconisch', label: 'Iconisch', tiers: ['iconisch'], factor: '×1' },
    { id: 'algemeen_bekend', label: 'Algemeen bekend', tiers: ['algemeen_bekend'], factor: '×2' },
    { id: 'bekend', label: 'Bekend', tiers: ['bekend'], factor: '×3' },
    { id: 'rest', label: 'Onbekend & cult', tiers: ['onbekend', 'cult'], factor: '×4–5' },
];

const CATEGORIEEN = [
    { waarde: 'beide', label: 'Films & Series', logo: '/logos/films-series.svg', uitleg: 'Hitster voor intro’s, themes en soundtracks' },
    { waarde: 'films', label: 'Films', logo: '/logos/films.svg', uitleg: 'Alleen films' },
    { waarde: 'series', label: 'Series', logo: '/logos/series.svg', uitleg: 'Alleen series' },
    { waarde: 'games', label: 'Videogames', logo: '/logos/music.svg', uitleg: 'Herken de muziek van bekende games op PC en consoles' },
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
const DEELNEMER_LEEFTIJDEN = Array.from({ length: 96 }, (_, index) => index + 4);
const RONDES = [
    { waarde: 10, label: 'Kort · 10 rondes' },
    { waarde: 20, label: 'Medium · 20 rondes' },
    { waarde: 30, label: 'Lang · 30 rondes' },
    { waarde: 0, label: 'Oneindig' },
];
// Bekendheid: hoeveel TMDB-stemmen een titel minimaal moet hebben.
const BEKENDHEID = [
    { waarde: 0, label: 'Onbekend / gecureerd' },
    { waarde: 200, label: 'Bekend' },
    { waarde: 1000, label: 'Heel bekend' },
    { waarde: 4000, label: 'Iconisch' },
];
const VRAAG_PROFIELEN = [
    { waarde: 'speler', label: 'Speler', uitleg: 'Alleen gecontroleerde vragen en nummers.' },
    { waarde: 'beta', label: 'Beta Tester', uitleg: 'Kan nieuwe of nog niet volledig geteste vragen krijgen en fouten melden.' },
];

function InfoTip({ tekst }) {
    return (
        <span className="info-tip" tabIndex="0" role="button" aria-label={tekst} data-tip={tekst}>
            i
        </span>
    );
}
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
    const [stap, setStap] = useState(1);
    const [quizzen, setQuizzen] = useState([]);
    const [quizSleutel, setQuizSleutel] = useState(null);
    const [quizGroep, setQuizGroep] = useState(null);
    const [hoofdgroep, setHoofdgroep] = useState('films');
    const [subkeuze, setSubkeuze] = useState('alles');
    const [presetKeuze, setPresetKeuze] = useState('');
    const [filters, setFilters] = useState({
        categorie: 'beide',
        categorieen: ['film', 'serie'],
        collecties: [],
        taal: 'beide',
        periode_start: 1930,
        periode_eind: NU,
        rondes: 10,
        spelvorm: 'tegen_elkaar',
        koth_modus: 'tegen',
        koth_stappen: 10,
        team_modus: 'snelste',
        hints_aan: true,
        speeltijd: 0,
        modus: 'snelste',
        antwoord_modus: 'meerkeuze',
        info_aan: true,
        bonusvragen_aan: true,
        vraag_profiel: 'speler',
        min_bekendheid: 0,
        // Standaard iconisch t/m bekend; onbekend en cult moet je bewust aanzetten.
        tiers: STANDAARD_TIERS,
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
    const [categorieBeelden, setCategorieBeelden] = useState({});
    useEffect(() => { fetch("/api/categorie-beelden").then(r=>r.ok?r.json():{}).then(setCategorieBeelden).catch(()=>{}); }, []);

    // Ook bij rechtstreeks openen van /setup blijft de hostaccount verplicht.
    useEffect(() => {
        authSessie().then((s) => {
            if (!s.ingelogd) navigate('/host/login?return=/setup/new', { replace: true });
            else setHost(s.gebruiker);
        }).catch(() => navigate('/host/login?return=/setup/new', { replace: true }));
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
            game_only: categorieen.includes('game'),
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
    const zichtbareQuizzen = quizzen.filter((q) => {
        const categorieen = q.filter?.categorieen || [];
        if (quizGroep === 'muziek') return categorieen.includes('muziek') || categorieen.includes('game');
        if (quizGroep === 'filmserie') return categorieen.includes('film') || categorieen.includes('serie') || categorieen.includes('anime');
        return false;
    });

    // Filters die bepálen wát er gespeeld wordt. Pas je daar één van aan, dan
    // klopt de naam van de gekozen editie niet meer. Rondes, speeltijd en
    // antwoordwijze veranderen de inhoud niet en laten de naam dus staan.
    const INHOUDSFILTERS = new Set([
        'game_only',
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

    // Collecties uit Beheer (ook nieuwe zoals Sinterklaas) verschijnen hier
    // vanzelf zodra er iets speelbaars in zit.
    function dbCollecties(soorten) {
        return collecties
            .filter((c) => soorten.includes(c.standaard_type) && (c.speelbaar ?? c.aantal) > 0)
            .map((c) => [c.sleutel, `${c.emoji || '✨'} ${c.naam}`]);
    }
    function emojiVan(id) {
        return collecties.find((c) => c.sleutel === id)?.emoji || null;
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
            ...p.extra_instellingen,
            categorie: p.categorie || 'beide',
            categorieen: p.categorieen || (p.categorie === 'films' ? ['film'] : p.categorie === 'series' ? ['serie'] : ['film', 'serie']),
            collecties: p.collecties || [],
            taal: p.taal,
            periode_start: p.periode_start,
            periode_eind: p.periode_eind,
            rondes: p.rondes,
            tiers: Array.isArray(p.extra_instellingen?.tiers) && p.extra_instellingen.tiers.length ? p.extra_instellingen.tiers : STANDAARD_TIERS,
            spelvorm: p.extra_instellingen?.spelvorm || 'tegen_elkaar',
            koth_modus: p.extra_instellingen?.koth_modus || 'tegen',
            koth_stappen: p.extra_instellingen?.koth_stappen || 10,
            team_modus: p.extra_instellingen?.team_modus || 'snelste',
            speeltijd: p.speeltijd ?? 0,
            modus: p.modus || 'snelste',
            antwoord_modus: p.antwoord_modus || 'meerkeuze',
            vraag_profiel: p.vraag_profiel || (p.alleen_gecontroleerd === true ? 'speler' : 'beta'),
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

    // Terug vanaf de spelinstellingen gaat naar de categoriekeuze (of de
    // edities als je een kant-en-klare quiz koos), niet langs de oude
    // tussenstappen taal en periode.
    const terug = () => {
        if (stap === 4) return setStap(quizSleutel ? 0 : 1);
        if (stap === 2 || stap === 3) return setStap(1);
        return stap > 0 ? setStap(stap - 1) : navigate('/');
    };
    const verder = () => setStap(Math.min(stap + 1, 4));

    return (
        <main className="scherm setup-scherm">
            {stap === 1 && <nav className="vt-category-topnav" aria-label="VenTune navigatie">
                <Link className="vt-top-brand" to="/"><img className="vt-top-equalizer" src="/category/equalizer.svg" alt="" /><strong><span>Ven</span>Tune</strong></Link>
                <div className="vt-top-links">
                    <Link className="vt-top-active" to="/setup"><img src="/category/icon-game.svg" alt="" />Spelen</Link>
                    <Link to="/"><img src="/category/icon-trophy.svg" alt="" />Scores</Link>
                    <Link to="/host/profile"><img src="/category/icon-users.svg" alt="" />Profielen</Link>
                    <Link to="/admin/bank"><img src="/category/icon-settings.svg" alt="" />Beheer</Link>
                </div>
                <Link className="vt-top-user" to="/host/profile"><span className="vt-avatar-ring">♫</span><span>{host?.display_naam || 'Profiel'}</span><span aria-hidden="true">⌄</span></Link>
            </nav>}
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

            {/* Stap 0: eerst de soort quiz, daarna pas de lange editie-lijst */}
            {stap === 0 && (
                <section>
                    <h1>Welke quiz?</h1>
                    <p className="dim">
                        Kies eerst Films &amp; Series, Muziek of stel zelf een quiz samen.
                    </p>
                    {!quizGroep ? (
                        <div className="keuzes setup-hoofdkeuze">
                            <button className="keuze" type="button" onClick={() => setQuizGroep('filmserie')}>
                                <span className="keuze-logo">🎬</span>
                                <strong>Films &amp; Series</strong>
                                <span className="keuze-uitleg">Intro&apos;s, themes en soundtracks</span>
                            </button>
                            <button className="keuze" type="button" onClick={() => setQuizGroep('muziek')}>
                                <span className="keuze-logo">🎵</span>
                                <strong>Muziek</strong>
                                <span className="keuze-uitleg">Muziekedities en collecties</span>
                            </button>
                            <button className="keuze" type="button" onClick={() => { setQuizSleutel(null); setStap(1); }}>
                                <span className="keuze-logo">⚙️</span>
                                <strong>Custom</strong>
                                <span className="keuze-uitleg">Zelf alle filters instellen</span>
                            </button>
                        </div>
                    ) : (
                        <>
                            <button className="terug als-link" type="button" onClick={() => setQuizGroep(null)}>
                                ← Andere quizsoort
                            </button>
                            {zichtbareQuizzen.length === 0 ? (
                                <p className="dim">Edities worden geladen…</p>
                            ) : (
                                <div className="quiz-grid quiz-grid-enkel">
                                    {zichtbareQuizzen.map((q) => (
                                        <button
                                            key={q.sleutel}
                                            type="button"
                                            className={'quiz-kaart' + (quizSleutel === q.sleutel ? ' gekozen' : '') + (q.klaar ? '' : ' leeg')}
                                            onClick={() => kiesQuiz(q)}
                                            disabled={q.speelbaar === 0}
                                        >
                                            <span className="quiz-emoji" aria-hidden="true">{q.emoji || '🎵'}</span>
                                            <span className="quiz-naam">{q.naam}</span>
                                            <span className="quiz-aantal">
                                                {q.speelbaar === 0 ? `${q.catalogus || 0} titels · 0 speelbare MP3's` : `${q.speelbaar} speelbaar` }
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                className="knop knop-stil"
                                type="button"
                                style={{ marginTop: '1rem' }}
                                onClick={() => { setQuizSleutel(null); setStap(1); }}
                            >
                                Zelf instellen
                            </button>
                        </>
                    )}
                </section>
            )}

            {/* Visuele categoriekeuze: vier hoofdcategorieën, daarna subfilters. */}
            {stap === 1 && (
                <section className="vt-categorie-scherm">
                    <h1>Kies een categorie</h1>
                    <p className="dim">Maak je eigen muziekquiz. Kies eerst een wereld en daarna wat je wilt horen.</p>
                    
                    <div className="vt-category-workspace"><div className="vt-category-left"><div className="vt-hoofdkaarten">
                        {[
                            {id:'films',naam:'Films & Series',icon:'/category/icon-film.svg',kleur:'#ff328e',beeld:categorieBeelden.films || '/category/approved-films.svg?v=hd840-20261101'},
                            {id:'muziek',naam:'Muziek',icon:'/category/icon-music.svg',kleur:'#17daf3',beeld:categorieBeelden.muziek || '/category/approved-music.svg?v=hd840-20261101'},
                            {id:'games',naam:'Videogames',icon:'/category/icon-game.svg',kleur:'#7e66ff',beeld:categorieBeelden.games || '/category/approved-games.svg?v=hd840-20261101'},
                            {id:'anime',naam:'Anime',icon:'/category/icon-film.svg',kleur:'#ff8a3d',beeld:categorieBeelden.anime || '/category/approved-anime.svg?v=1'},
                        ].map(g=><button key={g.id} type="button" className={'vt-hoofdkaart'+(hoofdgroep===g.id?' actief':'')}
                            style={{'--kaartkleur':g.kleur}} onClick={()=>{
                                setHoofdgroep(g.id);setSubkeuze('alles');setFilters(f=>({...f,speciale_keuze:'',platformen:[],met_genres:[],kindvriendelijk:false}));
                                if(g.id==='films')setFilters(f=>({...f,categorie:'beide',categorieen:['film','serie'],game_only:false,collecties:[],periode_start:1930,periode_eind:NU}));
                                if(g.id==='muziek')setFilters(f=>({...f,categorie:'muziek',categorieen:['muziek'],game_only:false,collecties:[],periode_start:1930,periode_eind:NU}));
                                if(g.id==='games')setFilters(f=>({...f,categorie:'games',categorieen:['game'],game_only:true,collecties:[],periode_start:1930,periode_eind:NU}));
                                if(g.id==='anime')setFilters(f=>({...f,categorie:'anime',categorieen:['anime'],game_only:false,collecties:[],periode_start:1930,periode_eind:NU}));
                                if(g.id==='thema')setFilters(f=>({...f,categorie:'beide',categorieen:['film','serie'],game_only:false,collecties:[],periode_start:1930,periode_eind:NU}));
                            }}>
                            <img className="vt-hoofdkaart-illustratie" src={g.beeld} alt="" loading="eager" />
                            <span className="vt-hoofdkaart-titel"><img src={g.icon} alt="" />{g.naam}</span>
                        </button>)}
                    </div>
                    <div className={"vt-categorie-paneel vt-categorie-"+hoofdgroep}>
                        <h2><img className="vt-panel-film-icon" src={"/category/icon-"+(hoofdgroep==="muziek"?"music":hoofdgroep==="games"?"game":hoofdgroep==="thema"?"theme":"film")+".svg"} alt="" /> {({films:'Films & Series',muziek:'Muziek',games:'Videogames',thema:'Thema'})[hoofdgroep]}</h2>
                        {hoofdgroep==='films'&&<div className="vt-subkeuzes">
                            <p>▱ &nbsp; Type</p>
                            <div className="vt-keuzerij">
                                {[['beide','Film & Serie',['film','serie']],['films','Alleen Films',['film']],['series','Alleen Series',['serie']]].map(([v,label,types])=>
                                <button type="button" key={v} className={'chip'+(filters.categorie===v?' gekozen':'')}
                                    onClick={()=>setFilters(f=>({...f,categorie:v,categorieen:types,game_only:false}))}><img className="vt-type-art" src={({beide:"/category/type-film-series.svg",films:"/category/type-films.svg",series:"/category/type-series.svg"})[v]} alt="" /><span className="vt-option-label">{label}</span></button>)}
                            </div>
                        </div>}
                        {(hoofdgroep==='films'||hoofdgroep==='muziek'||hoofdgroep==='games'||hoofdgroep==='thema')&&<div className="vt-subkeuzes">
                            <p>{hoofdgroep==='films'?'▱  Collectie':hoofdgroep==='muziek'?'Welk muziekgenre?':hoofdgroep==='games'?'Kies één of meerdere fabrikanten': 'Kies een thema'}</p>
                            <div className="vt-keuzerij">
                                {(hoofdgroep==='films'?[['alles','✨ Alles'],['80s','🌇 80’s'],['90s','📼 90’s'],['animatie','🎨 Animatie'],['kinder','🧸 Kinder'],...dbCollecties(['film','serie','beide','alles'])]
                                :hoofdgroep==='muziek'?[['alles','🎧 Alles'],...dbCollecties(['muziek','alles'])]
                                :hoofdgroep==='games'?[['alles','🎮 Alle games'],['nintendo','🕹️ Nintendo'],['sega','💫 Sega'],['playstation','🔵 PlayStation'],['xbox','🟢 Xbox'],['pc','💻 PC']]
                                :[['alles','✨ Alle thema’s'],['kerst','🎄 Kerst']]).map(([id,label])=>
                                    <button type="button" key={id} className={'chip'+((hoofdgroep==='games'? (id==='alles'?!(filters.platformen||[]).length:(filters.platformen||[]).includes(id)) :subkeuze===id)?' gekozen':'')}
                                        style={categorieBeelden['collectie-'+id] ? {'--custom-image': `url(${categorieBeelden['collectie-'+id]})`} : undefined}
                                        onClick={()=>{
                                            setSubkeuze(id);
                                            setFilters(f=>({...f,
                                                speciale_keuze:id==='alles'?'':id,
                                                platformen:hoofdgroep==='games'?(id==='alles'?[]:(f.platformen||[]).includes(id)?(f.platformen||[]).filter(x=>x!==id):[...(f.platformen||[]),id]):[],
                                                periode_start:id==='80s'?1980:id==='90s'?1990:1930,
                                                periode_eind:id==='80s'?1989:id==='90s'?1999:NU,
                                                kindvriendelijk:id==='kinder',
                                                collecties:hoofdgroep==='games'?[]:id==='alles'||id==='80s'||id==='90s'||id==='kinder'||id==='animatie'?[]:[id],
                                                met_genres:id==='animatie'?['Animatie','Animation']:[],
                                                zonder_genres:[]}));
                                        }}>{hoofdgroep === 'games'
                                            ? (categorieBeelden['platform-'+id]
                                                ? <span className="vt-collectie-pictogram"><img src={categorieBeelden['platform-'+id]} alt="" /></span>
                                                : null)
                                            : (!categorieBeelden["collectie-"+id] && !VASTE_BEELDEN[id] && emojiVan(id))
                                            ? <span className="vt-collectie-pictogram vt-collectie-emoji" aria-hidden="true">{emojiVan(id)}</span>
                                            : <span className="vt-collectie-pictogram" aria-hidden="true"><img src={(() => { const beelden = categorieBeelden; return beelden["collectie-"+id] || ({ "80s": "/category/collection-80s.svg", "90s": "/category/collection-90s.svg", animatie: "/category/collection-animatie.svg", kinder: "/category/collection-kinder.svg", kerst: "/category/collection-christmas.svg", alles: "/category/collection-all.svg" })[id] || "/category/icon-music.svg"; })()} alt="" onError={e=>{e.currentTarget.style.display="none"}} /></span>}<span className="vt-collectie-label">{label.replace(/^[^A-Za-zÀ-ÿ0-9]+/u,"").trim()}</span>{id==="alles"&&hoofdgroep==="films"&&<small>(volledige database)</small>}</button>)}
                            </div>
                        </div>}
                        
                        <div className="vt-subkeuzes vt-tiers">
                            <p>⭐ &nbsp; Hoe bekend? <small className="dim">(onbekender = meer punten)</small></p>
                            <div className="vt-tier-rij">
                                {TIER_KEUZES.map(({ id, label, tiers, factor }) => {
                                    const huidig = filters.tiers && filters.tiers.length ? filters.tiers : ALLE_TIERS;
                                    const aan = tiers.every((t) => huidig.includes(t));
                                    return <button type="button" key={id} className={'chip vt-tier-chip' + (aan ? ' gekozen' : '')}
                                        onClick={() => setFilters((f) => {
                                            const nu = f.tiers && f.tiers.length ? f.tiers : ALLE_TIERS;
                                            const volgende = aan ? nu.filter((x) => !tiers.includes(x)) : [...new Set([...nu, ...tiers])];
                                            // Nooit alles uit: dan blijft de vorige keuze staan.
                                            return volgende.length ? { ...f, tiers: volgende } : f;
                                        })}>
                                        {label} <small>{factor}</small></button>;
                                })}
                            </div>
                        </div>
                        <button className="vt-preset-link vt-preset-inline" type="button" onClick={()=>setStap(0)}>Of kies een kant-en-klare quiz</button>
                        <div className="vt-selection-summary"><span>Geselecteerd: <strong>{({films:"Films & Series",muziek:"Muziek",games:"Videogames",thema:"Thema",anime:"Anime"})[hoofdgroep]} · {hoofdgroep==="games"?"Games":hoofdgroep==="anime"?"Anime":filters.categorie==="films"?"Alleen Films":filters.categorie==="series"?"Alleen Series":"Film & Serie"} · {subkeuze==="alles"?"Alles":subkeuze}</strong></span><span className="vt-mix-toggle">⤨ &nbsp; Willekeurig mixen <input type="checkbox" checked={filters.willekeurig_mixen !== false} onChange={e=>zet("willekeurig_mixen",e.target.checked)} /></span></div>
                        <button className="knop vt-startknop" type="button" onClick={()=>setStap(4)}><span className="vt-play-text"><img src="/category/icon-play.svg" alt="" />Start de quiz</span></button>
                    </div>
                    </div></div>

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
                <section className="vt-compact-setup">
                    <div className="setup-bovenbalk kaart">
                        <label className="kaart-label">Preset</label>
                        <select
                            className="invoer compact-select"
                            value={presetKeuze}
                            onChange={(e) => {
                                const waarde = e.target.value;
                                setPresetKeuze(waarde);
                                const gekozen = presets.find((p) => String(p.id) === waarde);
                                if (gekozen) pasPresetToe(gekozen);
                            }}
                        >
                            <option value="">Kies een preset…</option>
                            {presets.map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
                        </select>
                    </div>
                    <h1>Spelinstellingen</h1>
                    <div className="vt-game-settings">
                        <section className="vt-options-panel">
                            <h2>Rondes</h2>
                            <div className="vt-choice-grid vt-four">
                                {RONDES.map((r,i)=><button type="button" key={r.waarde} className={'vt-option-card'+(filters.rondes===r.waarde?' selected':'')} onClick={()=>zet('rondes',r.waarde)}>
                                    <img className="vt-setup-art" src={categorieBeelden["setup-rondes-"+["kort","medium","lang","oneindig"][i]] || "/setup-icons/rondes-"+["kort","medium","lang","oneindig"][i]+".svg"} alt="" />
                                    <strong>{['Kort','Medium','Lang','Oneindig'][i]}</strong><small>{r.waarde ? r.waarde+' rondes':'Tot je stopt'}</small>
                                </button>)}
                            </div>
                        </section>
                        <section className="vt-options-panel">
                            <h2>Spelopties</h2>
                            <div className="vt-switch-grid">
                                {[
                                    ['kindvriendelijk','Kindvriendelijk','Geschikt voor kinderen',false],
                                    ['hints_aan','Hints tijdens het raden','Hints verschijnen tijdens het luisteren',true],
                                    ['bonusvragen_aan','Bonusvragen','Extra vragen na het raden',true],
                                    ['info_aan','Film- en serie-info','Poster en achtergrondinformatie na de ronde',true]
                                ].map(([key,titel,uitleg,aan])=><label className="vt-setting-switch" key={key}><img className="vt-setting-art" src={categorieBeelden["setup-spel-"+({kindvriendelijk:"kindvriendelijk",hints_aan:"hints",bonusvragen_aan:"bonus",info_aan:"info"})[key]] || "/setup-icons/spel-"+({kindvriendelijk:"kindvriendelijk",hints_aan:"hints",bonusvragen_aan:"bonus",info_aan:"info"})[key]+".svg"} alt="" /><span><strong>{titel}</strong><small>{uitleg}</small></span>
                                    <input type="checkbox" checked={aan?filters[key]!==false:filters[key]===true}
                                        onChange={e=>key==='kindvriendelijk'?setFilters(f=>({...f,kindvriendelijk:e.target.checked,leeftijd_max:e.target.checked?12:0})):zet(key,e.target.checked)}/>
                                    <span className="vt-switch-track" aria-hidden="true"/>
                                </label>)}
                            </div>
                        </section>
                        <section className="vt-options-panel">
                            <h2>Wie speelt?</h2>
                            <div className="vt-choice-grid">
                                {[
                                    ['tegen_elkaar','⚔️','Tegen elkaar','Iedereen speelt individueel'],
                                    ['om_en_om','🔄','Om en om','Elke speler krijgt een eigen beurt'],
                                    ['teams','👥','Teams','Speel samen tegen andere teams'],
                                    ['king_of_the_hill','⛰️','King of the Hill','Goed = omhoog, fout = omlaag. Wie staat bovenaan?']
                                ].map(([id,icoon,titel,uitleg])=><button type="button" key={id} className={'vt-option-card'+(filters.spelvorm===id?' selected':'')}
                                    onClick={()=>setFilters(f=>({...f,spelvorm:id,...(id==='king_of_the_hill'?{rondes:0}:{})}))}>
                                    <img className="vt-setup-art" src={categorieBeelden["setup-spel-"+id] || (id==='king_of_the_hill' && categorieBeelden['setup-spel-bergexpeditie']) || "/setup-icons/spel-"+(id==='king_of_the_hill'?'bergexpeditie':id)+".svg"} alt="" /><strong>{titel}</strong><small>{uitleg}</small>
                                </button>)}
                            </div>
                            {filters.spelvorm==='teams'&&<div className="vt-choice-grid vt-three">
                                {[['snelste','⚡','Snelste team'],['kenner','🧠','Alle teams raden'],['om_en_om','🔄','Teams om en om']].map(([id,icoon,label])=><button type="button" key={id} className={'vt-option-card'+(filters.team_modus===id?' selected':'')} onClick={()=>zet('team_modus',id)}><span className="vt-option-art">{icoon}</span><strong>{label}</strong></button>)}
                            </div>}
                            {filters.spelvorm==='king_of_the_hill'&&<>
                                <div className="vt-choice-grid vt-two">
                                    {[['tegen','⚔️','Tegen elkaar','Wie het eerst bovenaan staat wint'],['samen','🤝','Samen','Samen de berg op: één goed antwoord is genoeg']].map(([id,icoon,label,uitleg])=>
                                        <button type="button" key={id} className={'vt-option-card'+((filters.koth_modus||'tegen')===id?' selected':'')} onClick={()=>zet('koth_modus',id)}>
                                            <span className="vt-option-art">{icoon}</span><strong>{label}</strong><small>{uitleg}</small></button>)}
                                </div>
                                <label className="vt-select-duration">Hoe hoog is de berg?<select className="invoer" value={filters.koth_stappen||10} onChange={e=>zet('koth_stappen',Number(e.target.value))}>
                                    {[5,10,15,20].map(n=><option key={n} value={n}>{n} stappen</option>)}</select></label>
                            </>}
                        </section>
                        <div className="vt-settings-pair">
                            <section className="vt-options-panel">
                                <h2>Spelsoort</h2><div className="vt-choice-grid vt-two">
                                    {MODI.map((m,i)=><button key={m.waarde} type="button" className={'vt-option-card'+(filters.modus===m.waarde?' selected':'')} onClick={()=>zet('modus',m.waarde)}><img className="vt-setup-art" src={categorieBeelden["setup-modus-"+m.waarde] || "/setup-icons/modus-"+m.waarde+".svg"} alt="" /><strong>{m.label}</strong><small>{m.uitleg}</small></button>)}
                                </div>
                            </section>
                            <section className="vt-options-panel">
                                <h2>Antwoordwijze</h2><div className="vt-choice-grid vt-two">
                                    {ANTWOORD_MODI.map((m,i)=><button key={m.waarde} type="button" className={'vt-option-card'+(filters.antwoord_modus===m.waarde?' selected':'')} onClick={()=>zet('antwoord_modus',m.waarde)}><img className="vt-setup-art" src={categorieBeelden["setup-antwoord-"+m.waarde] || "/setup-icons/antwoord-"+(m.waarde==="meerkeuze"?"meerkeuze":"typen")+".svg"} alt="" /><strong>{m.label}</strong><small>{m.uitleg}</small></button>)}
                                </div>
                            </section>
                        </div>
                        <section className="vt-options-panel">
                            <label className="vt-setting-switch"><span><strong>Speeltijd per ronde</strong><small>Uit = heel nummer afspelen</small></span>
                                <input type="checkbox" checked={filters.speeltijd>0} onChange={e=>zet('speeltijd',e.target.checked?60:0)}/><span className="vt-switch-track" aria-hidden="true"/>
                            </label>
                            {filters.speeltijd>0&&<div className="vt-choice-grid vt-duration-grid">
                                <label className="vt-duration-slider"><span>Speeltijd: <strong>{filters.speeltijd >= 60 ? `${Math.floor(filters.speeltijd/60)} min${filters.speeltijd%60 ? ` ${filters.speeltijd%60} sec` : ""}` : `${filters.speeltijd} sec`}</strong></span><input type="range" min="10" max="180" step="10" value={filters.speeltijd} onChange={e=>zet("speeltijd",Number(e.target.value))} /><span className="vt-duration-ends"><small>10 seconden</small><small>3 minuten</small></span></label>
                            </div>}
                        </section>
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
                                    : spelNaam(filters)}
                            </strong>
                            {/* Het jaartal alleen tonen als er echt een periode gekozen is (80s, 90s …). */}
                            {(filters.periode_start > 1930 || filters.periode_eind < NU) ? ` · ${filters.periode_start}–${filters.periode_eind}` : ''}
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

                    <p className="dim setup-preset-hint">
                        Preset gekozen? Gebruik het menu bovenaan om een andere preset te laden.
                    </p>
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
    const periode = (p.periode_start > 1930 || p.periode_eind < NU) ? ` · ${p.periode_start}–${p.periode_eind}` : '';
    return `${(p.categorieen || []).some((c) => c === 'game' || c === 'anime') ? spelNaam(p) : cat}${collecties} · ${taal}${periode} · ${rondes} · ${tijd} · ${antwoord} · ${leeftijd} · ${tv}${controle}${kind}`;
}
