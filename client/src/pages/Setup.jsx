import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    maakLobby,
    haalTelling,
    haalPresets,
    haalCollecties,
    bewaarPreset,
    verwijderPreset,
    authSessie,
    authUitloggen,
} from '../lib/api.js';
import { bewaarSessie } from '../lib/sessie.js';
import Brand from '../components/Brand.jsx';

const NU = new Date().getFullYear();

const CATEGORIEEN = [
    { waarde: 'films', label: 'Films' },
    { waarde: 'series', label: 'Series' },
    { waarde: 'muziek', label: 'Muziek' },
    { waarde: 'beide', label: 'Beide' },
    { waarde: 'alles', label: 'Alles' },
];
const TALEN = [
    { waarde: 'nl', label: 'Nederlands' },
    { waarde: 'en', label: 'Internationaal' },
    { waarde: 'beide', label: 'Beide' },
];
const LEEFTIJDEN = [
    { waarde: 0, label: 'Alle leeftijden', uitleg: 'Volledige gecureerde catalogus' },
    { waarde: 10, label: 'Gezinsvriendelijk t/m 10', uitleg: 'Geschikt als een kind van 10 meedoet' },
    { waarde: 12, label: 'T/m 12 jaar', uitleg: 'Geen 16+ of 18+-titels' },
    { waarde: 16, label: 'T/m 16 jaar', uitleg: 'Geen 18+-titels' },
];
const RONDES = [
    { waarde: 10, label: '10' },
    { waarde: 20, label: '20' },
    { waarde: 30, label: '30' },
    { waarde: 0, label: 'Eindeloos' },
];
// Bekendheid: hoeveel TMDB-stemmen een titel minimaal moet hebben.
const BEKENDHEID = [
    { waarde: 0, label: 'Alles' },
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
    const [stap, setStap] = useState(1);
    const [filters, setFilters] = useState({
        categorie: 'beide',
        collecties: [],
        taal: 'beide',
        periode_start: 1930,
        periode_eind: NU,
        rondes: 10,
        speeltijd: 0,
        modus: 'snelste',
        antwoord_modus: 'typen',
        min_bekendheid: 200,
        zonder_genres: [],
        leeftijd_max: 0,
        alleen_nl_tv: true,
    });
    const [telling, setTelling] = useState(null);
    const [presets, setPresets] = useState([]);
    const [presetNaam, setPresetNaam] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    const [host, setHost] = useState(null);
    const [collecties, setCollecties] = useState([]);

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
    }, []);

    // Live telling ophalen wanneer de filters veranderen.
    const ververTelling = useCallback(() => {
        haalTelling(filters)
            .then(setTelling)
            .catch(() => setTelling(null));
    }, [filters]);

    useEffect(() => {
        ververTelling();
    }, [ververTelling]);

    function zet(sleutel, waarde) {
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

    function wisselCollectie(collectie) {
        setFilters((f) => {
            const huidig = f.collecties || [];
            const gekozen = huidig.includes(collectie.sleutel)
                ? huidig.filter((x) => x !== collectie.sleutel)
                : [...huidig, collectie.sleutel];
            const volgende = { ...f, collecties: gekozen };
            if (collectie.standaard_type === 'muziek' && gekozen.length === 1) volgende.categorie = 'muziek';
            if (collectie.standaard_type === 'film' && gekozen.length === 1) volgende.categorie = 'films';
            if (collectie.standaard_type === 'serie' && gekozen.length === 1) volgende.categorie = 'series';
            if (collectie.standaard_type === 'alles' && gekozen.length === 1) volgende.categorie = 'alles';
            if (collectie.sleutel === 'streaming' && gekozen.includes('streaming')) volgende.alleen_nl_tv = false;
            return volgende;
        });
    }

    async function opslaanPreset() {
        if (!presetNaam.trim()) return;
        try {
            const nieuw = await bewaarPreset({ naam: presetNaam.trim(), ...filters });
            setPresets((p) => [nieuw, ...p]);
            setPresetNaam('');
        } catch (err) {
            setFout(err.message);
        }
    }

    function pasPresetToe(p) {
        setFilters({
            categorie: p.categorie,
            collecties: p.collecties || [],
            taal: p.taal,
            periode_start: p.periode_start,
            periode_eind: p.periode_eind,
            rondes: p.rondes,
            speeltijd: p.speeltijd ?? 0,
            modus: p.modus || 'snelste',
            antwoord_modus: p.antwoord_modus || 'typen',
            min_bekendheid: p.min_bekendheid ?? 200,
            zonder_genres: p.zonder_genres || [],
            leeftijd_max: p.leeftijd_max ?? 0,
            alleen_nl_tv: p.alleen_nl_tv !== false,
        });
        setStap(4);
    }

    async function verwijder(id) {
        await verwijderPreset(id);
        setPresets((p) => p.filter((x) => x.id !== id));
    }

    async function start() {
        if (telling && !telling.genoeg) return;
        setBezig(true);
        setFout('');
        try {
            const lobby = await maakLobby(filters);
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

    const terug = () => (stap > 1 ? setStap(stap - 1) : navigate('/'));
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
                {[1, 2, 3, 4].map((n) => (
                    <span
                        key={n}
                        className={'stap-bol' + (n <= stap ? ' actief' : '')}
                    />
                ))}
            </div>

            {fout && <p className="waarschuwing">{fout}</p>}

            {/* Stap 1: Categorie */}
            {stap === 1 && (
                <section>
                    <h1>Categorie</h1>
                    <div className="keuzes">
                        {CATEGORIEEN.map((c) => (
                            <button
                                key={c.waarde}
                                className={
                                    'keuze' +
                                    (filters.categorie === c.waarde ? ' gekozen' : '')
                                }
                                onClick={() => {
                                    zet('categorie', c.waarde);
                                    verder();
                                }}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    {collecties.length > 0 && (
                        <>
                            <p className="kaart-label" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
                                Spelcollectie — Disney, Pixar, Marvel, Streaming, Smartlappen of Rock
                            </p>
                            <div className="chips">
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
                            {(filters.collecties || []).length > 0 && (
                                <p className="dim" style={{ marginTop: '0.5rem' }}>
                                    Meerdere collecties combineren mag. Frozen staat bijvoorbeeld in Films én Disney.
                                </p>
                            )}
                        </>
                    )}
                </section>
            )}

            {/* Stap 2: Taal/regio */}
            {stap === 2 && (
                <section>
                    <h1>Taal</h1>
                    <div className="keuzes">
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
                                {t.label}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* Stap 3: Periode */}
            {stap === 3 && (
                <section>
                    <h1>Periode</h1>
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
                        {telling ? (
                            telling.genoeg ? (
                                <p className="dim">
                                    {telling.titels} titels beschikbaar met deze filters.
                                </p>
                            ) : (
                                <p className="waarschuwing">
                                    Slechts {telling.titels} titels — je hebt er minstens{' '}
                                    {telling.drempel} nodig. Verruim de filters of voeg
                                    meer nummers toe.
                                </p>
                            )
                        ) : (
                            <p className="dim">Beschikbare titels tellen…</p>
                        )}
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
    const taal = p.taal === 'nl' ? 'NL' : p.taal === 'en' ? 'Int' : 'NL+Int';
    const rondes = p.rondes === 0 ? 'eindeloos' : `${p.rondes} rondes`;
    const tijd = p.speeltijd === 0 ? 'heel nummer' : `${p.speeltijd}s`;
    const antwoord = p.antwoord_modus === 'meerkeuze' ? '6 opties' : 'typen';
    const leeftijd = p.leeftijd_max ? `t/m ${p.leeftijd_max}` : 'alle leeftijden';
    const tv = p.alleen_nl_tv === false ? 'alle catalogus' : 'NL-tv';
    const collecties = (p.collecties || []).length ? ` · ${p.collecties.join(', ')}` : '';
    return `${cat}${collecties} · ${taal} · ${p.periode_start}–${p.periode_eind} · ${rondes} · ${tijd} · ${antwoord} · ${leeftijd} · ${tv}`;
}
