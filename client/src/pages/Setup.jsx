import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    maakLobby,
    haalTelling,
    haalPresets,
    bewaarPreset,
    verwijderPreset,
} from '../lib/api.js';
import { bewaarSessie } from '../lib/sessie.js';

const NU = new Date().getFullYear();

const CATEGORIEEN = [
    { waarde: 'films', label: 'Films' },
    { waarde: 'series', label: 'Series' },
    { waarde: 'beide', label: 'Beide' },
];
const TALEN = [
    { waarde: 'nl', label: 'Nederlands' },
    { waarde: 'en', label: 'Internationaal' },
    { waarde: 'beide', label: 'Beide' },
];
const RONDES = [
    { waarde: 10, label: '10' },
    { waarde: 20, label: '20' },
    { waarde: 30, label: '30' },
    { waarde: 0, label: 'Eindeloos' },
];
const PERIODE_SNEL = [
    { label: 'Alles', van: 1950, tot: NU },
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
        taal: 'beide',
        periode_start: 1950,
        periode_eind: NU,
        rondes: 10,
    });
    const [telling, setTelling] = useState(null);
    const [presets, setPresets] = useState([]);
    const [presetNaam, setPresetNaam] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);

    // Presets laden bij binnenkomst.
    useEffect(() => {
        haalPresets().then(setPresets).catch(() => {});
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
            taal: p.taal,
            periode_start: p.periode_start,
            periode_eind: p.periode_eind,
            rondes: p.rondes,
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
                        min={1950}
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
                        min={1950}
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
              : 'Beide';
    const taal = p.taal === 'nl' ? 'NL' : p.taal === 'en' ? 'Int' : 'NL+Int';
    const rondes = p.rondes === 0 ? 'eindeloos' : `${p.rondes} rondes`;
    return `${cat} · ${taal} · ${p.periode_start}–${p.periode_eind} · ${rondes}`;
}
