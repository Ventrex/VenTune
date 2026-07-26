import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import { audioBron } from '../lib/api.js';
import { haalVideoId } from '../lib/youtube.js';
import Brand from '../components/Brand.jsx';

// Beheerportaal (/admin). Wachtwoord uit ADMIN_PASSWORD op de server.
export default function Admin() {
    const [ingelogd, setIngelogd] = useState(null); // null=laden

    useEffect(() => {
        api.adminSessie().then((s) => setIngelogd(s.ingelogd));
    }, []);

    if (ingelogd === null) return <main className="scherm"><p className="dim">Laden…</p></main>;
    if (!ingelogd) return <Login onIn={() => setIngelogd(true)} />;
    return <Beheer onUit={() => setIngelogd(false)} />;
}

function Login({ onIn }) {
    const [ww, setWw] = useState('');
    const [fout, setFout] = useState('');
    async function verstuur(e) {
        e.preventDefault();
        try {
            await api.adminLogin(ww);
            onIn();
        } catch (err) {
            setFout(err.message);
        }
    }
    return (
        <main className="scherm">
            <Brand compact />
            <h1>Beheer</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            <form onSubmit={verstuur} className="stapel">
                <input
                    className="invoer"
                    type="password"
                    value={ww}
                    onChange={(e) => setWw(e.target.value)}
                    placeholder="Wachtwoord"
                    aria-label="Wachtwoord"
                    autoFocus
                />
                <button className="knop" type="submit">Inloggen</button>
            </form>
            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/">← Terug</Link>
            </p>
        </main>
    );
}

function Beheer({ onUit }) {
    const [titels, setTitels] = useState([]);
    const [zoek, setZoek] = useState('');
    const [melding, setMelding] = useState('');
    const [bezigSeed, setBezigSeed] = useState(false);
    const [bezigPlaylist, setBezigPlaylist] = useState(false);
    const [bezigTmdb, setBezigTmdb] = useState(false);
    const [bezigVragen, setBezigVragen] = useState(false);
    const [bezigDownloads, setBezigDownloads] = useState(false);
    const [bezigCollecties, setBezigCollecties] = useState(false);
    const [open, setOpen] = useState(null); // uitgeklapte titel-id
    const [meldingen, setMeldingen] = useState([]);
    const [overzicht, setOverzicht] = useState(null);
    const [gebruikers, setGebruikers] = useState([]);
    const [spelers, setSpelers] = useState([]);
    const [ontbrekend, setOntbrekend] = useState([]);
    const [collecties, setCollecties] = useState([]);
    const [tab, setTab] = useState('overzicht');

    async function laad(zoekOverride = zoek) {
        try {
            setTitels(await api.adminTitels(zoekOverride));
            setOntbrekend(await api.adminOntbrekendeTracks());
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function laadMeldingen() {
        try {
            setMeldingen(await api.adminMeldingen(true));
        } catch { /* niet fataal */ }
    }
    async function laadOverzicht() {
        try {
            setOverzicht(await api.adminOverzicht());
        } catch { /* niet fataal */ }
    }
    async function laadGebruikers() {
        try {
            setGebruikers(await api.adminGebruikers());
            setSpelers(await api.adminSpelers());
        } catch { /* niet fataal */ }
    }
    async function laadCollecties() {
        try { setCollecties(await api.adminCollecties()); } catch { /* niet fataal */ }
    }
    useEffect(() => {
        laad();
        laadMeldingen();
        laadOverzicht();
        laadGebruikers();
        laadCollecties();
        /* eslint-disable-next-line */
    }, []);

    async function meldingAf(id) {
        await api.adminMeldingAf(id);
        laadMeldingen();
    }

    async function seed() {
        setBezigSeed(true);
        setMelding('Seed importeren… dit draait in de achtergrond (1–3 min).');
        try {
            // Force is veilig: importeer vervangt pas nadat een nieuwe,
            // gecontroleerde YouTube-track is gevonden.
            const gestart = await api.adminSeed(true);
            if (gestart?.gestart === false) {
                setBezigSeed(false);
                setMelding(`Admin-taak "${gestart.taak || 'import'}" is al bezig.`);
                return;
            }
            // Status pollen tot de import klaar is.
            const poll = setInterval(async () => {
                try {
                    const st = await api.adminSeedStatus();
                    if (st.klaar) {
                        clearInterval(poll);
                        setBezigSeed(false);
                        if (st.fout) {
                            setMelding('Seed mislukt: ' + st.fout);
                        } else if (st.samenvatting) {
                            const s = st.samenvatting;
                            setMelding(
                                `Seed klaar: ${s.metTrack}/${s.verwerkt} titels met track.` +
                                (s.zonder.length
                                    ? ` Zonder clip (${s.zonder.length}): ${s.zonder.join(', ')}.`
                                    : ''),
                            );
                        }
                        laad();
                    } else if (st.bezig) {
                        setMelding('Seed importeren… bezig, even geduld (1–3 min).');
                    }
                } catch {
                    /* blijf pollen */
                }
            }, 2500);
        } catch (err) {
            setMelding('Seed starten mislukt: ' + err.message);
            setBezigSeed(false);
        }
    }

    async function uitloggen() {
        await api.adminLogout();
        onUit();
    }

    async function downloadVooraf(collectieSlugs = []) {
        await achtergrondTaak(
            () => api.adminDownloadStart({ collecties: collectieSlugs, controleer: true }),
            api.adminDownloadStatus,
            setBezigDownloads,
            collectieSlugs.length ? 'Collectietracks controleren en vooraf downloaden…' : 'Alle beschikbare MP3-tracks controleren en vooraf downloaden…',
            'Vooraf downloaden klaar.',
        );
    }

    async function importeerCollecties(collectieSlugs) {
        await achtergrondTaak(
            () => api.adminCollectieImport({ collecties: collectieSlugs, download: true }),
            api.adminCollectieImportStatus,
            setBezigCollecties,
            'Collectie vullen, YouTube-matches controleren en MP3 downloaden…',
            'Collectie importeren en downloaden klaar.',
        );
        laadCollecties();
    }

    async function playlistImport() {
        setBezigPlaylist(true);
        setMelding('YouTube-playlists importeren… duidelijke matches vervangen veilig de oude track.');
        try {
            const gestart = await api.adminPlaylistImport();
            if (gestart?.gestart === false) {
                setBezigPlaylist(false);
                setMelding(`Admin-taak "${gestart.taak || 'import'}" is al bezig.`);
                return;
            }
            const poll = setInterval(async () => {
                try {
                    const st = await api.adminPlaylistStatus();
                    if (st.klaar) {
                        clearInterval(poll);
                        setBezigPlaylist(false);
                        if (st.fout) setMelding('Playlist-import mislukt: ' + st.fout);
                        else setMelding(`Playlist-import klaar: ${st.samenvatting?.gekoppeld || 0} matches gekoppeld.`);
                        laad();
                    }
                } catch {
                    /* blijf pollen */
                }
            }, 2500);
        } catch (err) {
            setMelding('Playlist-import starten mislukt: ' + err.message);
            setBezigPlaylist(false);
        }
    }

    async function achtergrondTaak(start, status, setBezig, bezigTekst, klaarTekst) {
        setBezig(true);
        setMelding(bezigTekst);
        try {
            const gestart = await start();
            if (gestart?.gestart === false) {
                setBezig(false);
                setMelding(`Admin-taak "${gestart.taak || 'import'}" is al bezig.`);
                return;
            }
            const poll = setInterval(async () => {
                try {
                    const st = await status();
                    if (st.klaar) {
                        clearInterval(poll);
                        setBezig(false);
                        setMelding(st.fout ? `${klaarTekst} mislukt: ${st.fout}` : klaarTekst);
                        laad();
                        laadOverzicht();
                    }
                } catch {
                    /* blijf pollen */
                }
            }, 2500);
        } catch (err) {
            setMelding(`${klaarTekst} starten mislukt: ${err.message}`);
            setBezig(false);
        }
    }

    return (
        <main className="scherm host-scherm">
            <Brand compact />
            <div className="raden-kop">
                <h1 style={{ margin: 0 }}>Beheer</h1>
                <button className="terug als-link" onClick={uitloggen}>Uitloggen</button>
            </div>

            <nav className="admin-tabs" aria-label="Adminsecties">
                {[
                    ['overzicht', 'Overzicht'],
                    ['titels', 'Titels & muziek'],
                    ['import', 'Import & downloads'],
                    ['collecties', 'Spelcollecties'],
                    ['meldingen', `Meldingen${meldingen.length ? ` (${meldingen.length})` : ''}`],
                    ['users', `Users (${gebruikers.length})`],
                    ['database', 'Database'],
                    ['uiterlijk', 'Uiterlijk'],
                ].map(([waarde, label]) => (
                    <button
                        key={waarde}
                        type="button"
                        className={'admin-tab' + (tab === waarde ? ' actief' : '')}
                        onClick={() => setTab(waarde)}
                    >
                        {label}
                    </button>
                ))}
            </nav>

            {melding && <p className="waarschuwing">{melding}</p>}

            {tab === 'overzicht' && overzicht && (
                <div className="overzicht">
                    <Tegel label="Titels" waarde={overzicht.titels} />
                    <Tegel label="Speelbaar" waarde={overzicht.speelbaar} />
                    <Tegel label="Tracks nodig" waarde={overzicht.ontbrekende_tracks} />
                    <Tegel label="Tracks" waarde={overzicht.tracks} />
                    <Tegel label="Afgekeurd" waarde={overzicht.afgekeurd} />
                    <Tegel label="Vragen" waarde={overzicht.vragen} />
                    <Tegel label="Open meldingen" waarde={overzicht.open_meldingen} />
                    <Tegel label="Cache" waarde={overzicht.cache_regels} />
                </div>
            )}
            {tab === 'overzicht' && overzicht?.per_bron?.length > 0 && (
                <p className="dim admin-bronnen">
                    Audiobronnen:{' '}
                    {overzicht.per_bron.map((bron) => `${bron.bron}: ${bron.n}`).join(' · ')}
                </p>
            )}

            {tab === 'users' && <Hostaccounts gebruikers={gebruikers} spelers={spelers} onWijzig={laadGebruikers} />}

            {tab === 'import' && ontbrekend.length > 0 && (
                <section className="admin-accounts" style={{ marginTop: '1rem' }}>
                    <p className="kaart-label" style={{ textAlign: 'left' }}>
                        Tracks nodig ({ontbrekend.length})
                    </p>
                    <p className="dim">
                        Deze titels worden niet in een spel gekozen totdat je via YouTube
                        een match opslaat of zelf audio uploadt.
                    </p>
                    <ul className="spelerlijst">
                        {ontbrekend.map((t) => (
                            <li key={t.id} className="speler-kaart">
                                <span className="speler-naam">
                                    {t.naam}
                                    <span className="dim"> · {t.type} · {t.jaar || 'jaar onbekend'}</span>
                                </span>
                                <button
                                    className="afspeelknop klein"
                                    onClick={() => { setZoek(t.naam); setOpen(t.id); laad(t.naam); }}
                                >
                                    Toevoegen
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {tab === 'import' && <div className="stapel" style={{ marginTop: '1rem' }}>
                <button className="knop knop-stil" onClick={seed} disabled={bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen}>
                    {bezigSeed ? 'Bezig…' : 'YouTube-first muziek vernieuwen'}
                </button>
                <button className="knop knop-stil" onClick={playlistImport} disabled={bezigPlaylist || bezigSeed || bezigTmdb || bezigVragen}>
                    {bezigPlaylist ? 'Playlists importeren…' : 'YouTube-playlists verversen'}
                </button>
                <button
                    className="knop knop-stil"
                    onClick={() => achtergrondTaak(api.adminTmdbImport, api.adminTmdbStatus, setBezigTmdb, 'TMDB-titels importeren…', 'TMDB-import klaar.')}
                    disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen}
                >
                    {bezigTmdb ? 'TMDB importeren…' : 'TMDB-titels importeren'}
                </button>
                <div className="zoekbalk">
                    <button className="knop knop-stil" onClick={() => achtergrondTaak(() => api.adminTmdbImport('film'), api.adminTmdbStatus, setBezigTmdb, 'Nieuwe films ophalen…', 'Nieuwe films ophalen klaar.')} disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen}>
                        Nieuwe films ophalen
                    </button>
                    <button className="knop knop-stil" onClick={() => achtergrondTaak(() => api.adminTmdbImport('serie'), api.adminTmdbStatus, setBezigTmdb, 'Nieuwe series ophalen…', 'Nieuwe series ophalen klaar.')} disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen}>
                        Nieuwe series ophalen
                    </button>
                </div>
                <button
                    className="knop knop-stil"
                    onClick={() => achtergrondTaak(() => api.adminVragenImport(false), api.adminVragenStatus, setBezigVragen, 'Bonusvragen genereren…', 'Bonusvragen genereren klaar.')}
                    disabled={bezigVragen || bezigSeed || bezigPlaylist || bezigTmdb}
                >
                    {bezigVragen ? 'Vragen genereren…' : 'Bonusvragen genereren'}
                </button>
                <button className="knop" onClick={() => downloadVooraf()} disabled={bezigDownloads || bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen || bezigCollecties}>
                    {bezigDownloads ? 'MP3’s controleren/downloaden…' : 'Alle MP3’s vooraf downloaden + URL controleren'}
                </button>
            </div>}

            {tab === 'collecties' && (
                <Collectiebeheer
                    collecties={collecties}
                    bezig={bezigCollecties}
                    onImport={importeerCollecties}
                    onDownload={downloadVooraf}
                    onWijzig={laadCollecties}
                    onMelding={setMelding}
                />
            )}

            {tab === 'meldingen' && meldingen.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                    <p className="kaart-label" style={{ textAlign: 'left' }}>
                        Alle meldingen ({meldingen.length})
                    </p>
                    <ul className="spelerlijst">
                        {meldingen.map((m) => (
                            <li key={m.id} className="speler-kaart">
                                <span className="speler-naam" style={{ fontSize: '1rem' }}>
                                    {m.titel_naam || '(titel weg)'}
                                    <span className="dim"> · {m.soort.replace('_', ' ')}</span>
                                    {m.tracknaam && (
                                        <span className="dim"> · {m.tracknaam}</span>
                                    )}
                                    {m.afgehandeld && <span className="dim"> · afgehandeld</span>}
                                </span>
                                <span style={{ display: 'flex', gap: '0.4rem' }}>
                                    {!m.afgehandeld && <button
                                        className="afspeelknop klein"
                                        title="Opnieuw zoeken via zoekveld"
                                        onClick={() => { setZoek(m.titel_naam || ''); laad(); }}
                                    >
                                        🔍
                                    </button>}
                                    {!m.afgehandeld && <button
                                        className="afspeelknop klein"
                                        title="Afgehandeld"
                                        onClick={() => meldingAf(m.id)}
                                    >
                                        ✓
                                    </button>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {tab === 'titels' && <>
            <form
                className="zoekbalk"
                style={{ marginTop: '1.5rem' }}
                onSubmit={(e) => { e.preventDefault(); laad(); }}
            >
                <input
                    className="invoer"
                    value={zoek}
                    onChange={(e) => setZoek(e.target.value)}
                    placeholder="Zoek titel…"
                />
                <button className="knop" type="submit">Zoek</button>
            </form>

            <NieuweTitel onKlaar={laad} />

            <p className="kaart-label" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
                Titels ({titels.length})
            </p>
            <ul className="spelerlijst">
                {titels.map((t) => (
                    <li key={t.id} className="titel-blok">
                        <div
                            className="titel-rij"
                            onClick={() => setOpen(open === t.id ? null : t.id)}
                        >
                            <span className="speler-naam">
                                {t.naam}
                                <span className="dim"> · {t.type} · {t.taal} · {t.jaar || '—'} · {t.curatie_status || '—'} · {t.leeftijdsgrens ?? 16}+{t.collecties?.length ? ` · ${t.collecties.join(', ')}` : ''}</span>
                            </span>
                            <span className={'track-badge' + (t.aantal_tracks ? '' : ' leeg')}>
                                {t.aantal_tracks} ♪
                            </span>
                        </div>
                        {open === t.id && (
                            <TitelDetail titel={t} onWijzig={laad} />
                        )}
                    </li>
                ))}
            </ul>
            </>}

            {tab === 'database' && <Databasebeheer onMelding={setMelding} />}
            {tab === 'uiterlijk' && <Uiterlijk onMelding={setMelding} />}

            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/">← Terug naar start</Link>
            </p>
        </main>
    );
}

function Tegel({ label, waarde }) {
    return (
        <div className="tegel">
            <span className="tegel-waarde">{waarde ?? '—'}</span>
            <span className="tegel-label">{label}</span>
        </div>
    );
}

function Collectiebeheer({ collecties, bezig, onImport, onDownload, onWijzig, onMelding }) {
    const [nieuw, setNieuw] = useState({ sleutel: '', naam: '', beschrijving: '', standaard_type: 'beide', toevoeg_reden: '' });

    async function maak(e) {
        e.preventDefault();
        try {
            await api.adminMaakCollectie(nieuw);
            setNieuw({ sleutel: '', naam: '', beschrijving: '', standaard_type: 'beide', toevoeg_reden: '' });
            onWijzig();
        } catch (err) { onMelding(err.message); }
    }

    async function wisselActief(c) {
        try { await api.adminUpdateCollectie(c.id, { actief: !c.actief }); onWijzig(); }
        catch (err) { onMelding(err.message); }
    }

    return (
        <section className="admin-panel">
            <div className="kaart">
                <p className="kaart-label">Edities / spelcollecties</p>
                <p className="dim">
                    Een titel kan meerdere collecties hebben. Type blijft film, serie of muziek; Disney, Pixar, Marvel,
                    Streaming, Smartlappen en Rock zijn aanvullende edities.
                </p>
                <div className="stapel">
                    {collecties.map((c) => (
                        <div key={c.id} className="speler-kaart">
                            <span>
                                <strong>{c.naam}</strong>
                                <span className="dim"> · {c.sleutel} · {c.aantal} titels · standaard {c.standaard_type}</span>
                                {!c.actief && <span className="dim"> · uitgeschakeld</span>}
                            </span>
                            <span className="admin-account-acties">
                                <button className="afspeelknop klein" disabled={bezig} onClick={() => onImport([c.sleutel])}>
                                    {bezig ? '…' : 'Vullen + MP3'}
                                </button>
                                <button className="afspeelknop klein" onClick={() => onDownload([c.sleutel])}>
                                    ⇩ MP3
                                </button>
                                <button className="afspeelknop klein" onClick={() => wisselActief(c)}>
                                    {c.actief ? 'Uit' : 'Aan'}
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
                <button className="knop knop-stil" type="button" onClick={() => onDownload(collecties.map((c) => c.sleutel))} disabled={bezig}>
                    Alle collectie-MP3’s controleren en downloaden
                </button>
            </div>
            <form className="kaart" style={{ marginTop: '1rem' }} onSubmit={maak}>
                <p className="kaart-label">Nieuwe editie toevoegen</p>
                <div className="velden">
                    <input className="invoer" required value={nieuw.naam} placeholder="Naam, bijvoorbeeld Kerst" onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} />
                    <input className="invoer" required value={nieuw.sleutel} placeholder="Sleutel, bijvoorbeeld kerst" onChange={(e) => setNieuw({ ...nieuw, sleutel: e.target.value })} />
                    <input className="invoer" value={nieuw.beschrijving} placeholder="Beschrijving" onChange={(e) => setNieuw({ ...nieuw, beschrijving: e.target.value })} />
                    <select className="invoer" value={nieuw.standaard_type} onChange={(e) => setNieuw({ ...nieuw, standaard_type: e.target.value })}>
                        <option value="beide">Films + series</option><option value="film">Films</option><option value="serie">Series</option><option value="muziek">Muziek</option><option value="alles">Alles</option>
                    </select>
                    <input className="invoer" value={nieuw.toevoeg_reden} placeholder="Waarom voeg je deze editie toe?" onChange={(e) => setNieuw({ ...nieuw, toevoeg_reden: e.target.value })} />
                </div>
                <button className="knop knop-stil" type="submit">Editie opslaan</button>
            </form>
        </section>
    );
}

function Databasebeheer({ onMelding }) {
    const [db, setDb] = useState(null);
    const [bezig, setBezig] = useState(false);

    async function laad() {
        try { setDb(await api.adminDatabase()); }
        catch (err) { onMelding(err.message); }
    }
    useEffect(() => { laad(); /* eslint-disable-next-line */ }, []);

    async function opschonen(actie, bevestiging) {
        if (!window.confirm(bevestiging)) return;
        setBezig(true);
        try {
            const res = await api.adminDatabaseOpschonen(actie);
            onMelding(`${res.verwijderd} records verwijderd.`);
            await laad();
        } catch (err) { onMelding(err.message); }
        finally { setBezig(false); }
    }

    return (
        <section className="admin-panel">
            <div className="kaart">
                <p className="kaart-label">Database</p>
                <p className="dim">
                    PostgreSQL bevat titels, tracks, meldingen, presets, users en spelhistorie.
                    Wachtwoordhashes worden nooit geëxporteerd.
                </p>
                <button className="knop knop-stil" type="button" onClick={() => { window.location.href = '/api/admin/database/export'; }}>
                    Database exporteren (JSON)
                </button>
            </div>
            <div className="kaart" style={{ marginTop: '1rem' }}>
                <p className="kaart-label">Tabellen</p>
                <ul className="spelerlijst">
                    {(db?.tabellen || []).map((t) => (
                        <li key={t.tabel} className="speler-kaart">
                            <span>{t.tabel}</span><span className="dim">{t.schatting} records</span>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="kaart" style={{ marginTop: '1rem' }}>
                <p className="kaart-label">Opschonen</p>
                <p className="dim">Deze acties verwijderen alleen de gekozen categorie. Audio-bestanden blijven staan.</p>
                <div className="stapel">
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('zoek_cache', 'Alle zoekresultaat-cache verwijderen?')}>Zoekcache leegmaken</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('afgehandelde_meldingen', 'Afgehandelde meldingen verwijderen?')}>Afgehandelde meldingen verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('spelgeschiedenis', 'Alle afgelopen spellen verwijderen?')}>Spelgeschiedenis verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('afgekeurde_tracks', 'Alle afgekeurde tracks uit de database verwijderen?')}>Afgekeurde tracks verwijderen</button>
                </div>
            </div>
        </section>
    );
}

function Uiterlijk({ onMelding }) {
    const standaard = {
        appNaam: 'VenTune',
        ondertitel: 'Muziekquiz over films en series',
        logoPad: '/icon.svg',
        achtergrond: '#000000',
        oppervlak: '#0a0a0a',
        rand: '#1c1c1c',
        accent: '#c41230',
        accentDonker: '#8b0f1d',
        tekst: '#f5f5f5',
        tekstDim: '#8a8a8a',
        lettertype: 'system-ui',
    };
    const [thema, setThema] = useState(standaard);
    const [logo, setLogo] = useState(null);
    const [bezig, setBezig] = useState(false);

    useEffect(() => {
        api.adminInstellingen().then((data) => setThema({ ...standaard, ...(data.thema || {}) }))
            .catch((err) => onMelding(err.message));
        /* eslint-disable-next-line */
    }, []);

    function zet(sleutel, waarde) { setThema((oud) => ({ ...oud, [sleutel]: waarde })); }
    async function bewaar() {
        setBezig(true);
        try {
            await api.adminBewaarThema(thema);
            onMelding('Uiterlijk opgeslagen. Spelers zien dit bij de volgende pagina-lading.');
        } catch (err) { onMelding(err.message); }
        finally { setBezig(false); }
    }
    async function upload() {
        if (!logo) return;
        setBezig(true);
        try {
            const data = await api.adminUploadLogo(logo);
            setThema({ ...thema, ...(data.thema || {}) });
            setLogo(null);
            onMelding('Logo opgeslagen.');
        } catch (err) { onMelding(err.message); }
        finally { setBezig(false); }
    }

    const kleuren = [
        ['achtergrond', 'Achtergrond'], ['oppervlak', 'Kaarten'], ['rand', 'Randen'],
        ['accent', 'Accent'], ['accentDonker', 'Donker accent'], ['tekst', 'Tekst'], ['tekstDim', 'Gedempte tekst'],
    ];
    return (
        <section className="admin-panel">
            <div className="kaart">
                <p className="kaart-label">Uiterlijk voor spelers</p>
                <p className="dim">Pas kleuren, tekst, lettertype en logo aan zonder het admin-wachtwoord in de database te zetten.</p>
                <div className="velden">
                    <input className="invoer" value={thema.appNaam} onChange={(e) => zet('appNaam', e.target.value)} placeholder="Naam van het spel" />
                    <input className="invoer" value={thema.ondertitel} onChange={(e) => zet('ondertitel', e.target.value)} placeholder="Ondertitel" />
                    <select className="invoer" value={thema.lettertype} onChange={(e) => zet('lettertype', e.target.value)}>
                        {['system-ui', 'Inter', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'monospace'].map((font) => <option key={font} value={font}>{font}</option>)}
                    </select>
                    {kleuren.map(([sleutel, label]) => (
                        <label key={sleutel} className="kleur-veld">
                            <span>{label}</span>
                            <input type="color" value={thema[sleutel]} onChange={(e) => zet(sleutel, e.target.value)} aria-label={label} />
                            <code>{thema[sleutel]}</code>
                        </label>
                    ))}
                </div>
                <button className="knop" disabled={bezig} onClick={bewaar}>Uiterlijk opslaan</button>
            </div>
            <div className="kaart" style={{ marginTop: '1rem' }}>
                <p className="kaart-label">Logo</p>
                <p className="dim">PNG, JPG, WebP of SVG. Het bestand wordt blijvend opgeslagen in <code>/media/uploads</code>.</p>
                <input className="invoer" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setLogo(e.target.files?.[0] || null)} />
                {thema.logoPad && <img src={thema.logoPad} alt="Huidig VenTune-logo" className="admin-logo-preview" />}
                <button className="knop knop-stil" disabled={bezig || !logo} onClick={upload}>Logo uploaden</button>
            </div>
        </section>
    );
}

function Hostaccounts({ gebruikers, spelers, onWijzig }) {
    async function wissel(gebruiker) {
        try {
            await api.adminGebruikerStatus(gebruiker.id, !gebruiker.actief);
            onWijzig();
        } catch (err) {
            alert(err.message);
        }
    }
    async function reset(gebruiker) {
        const nieuw = window.prompt(
            `Nieuw tijdelijk wachtwoord voor ${gebruiker.gebruikersnaam} (minimaal 10 tekens):`,
        );
        if (nieuw === null) return;
        try {
            await api.adminResetWachtwoord(gebruiker.id, nieuw);
            alert('Wachtwoord ingesteld. De host moet opnieuw inloggen.');
            onWijzig();
        } catch (err) {
            alert(err.message);
        }
    }

    async function bewerk(gebruiker) {
        const gebruikersnaam = window.prompt('Gebruikersnaam:', gebruiker.gebruikersnaam);
        if (gebruikersnaam === null) return;
        const displayNaam = window.prompt('Zichtbare hostnaam:', gebruiker.display_naam);
        if (displayNaam === null) return;
        try {
            await api.adminBewerkGebruiker(gebruiker.id, { gebruikersnaam, display_naam: displayNaam });
            onWijzig();
        } catch (err) {
            alert(err.message);
        }
    }

    return (
        <section className="admin-accounts">
            <p className="kaart-label" style={{ textAlign: 'left' }}>
                Hostaccounts ({gebruikers.length})
            </p>
            <NieuweHost onKlaar={onWijzig} />
            {gebruikers.length === 0 ? (
                <p className="dim">Nog geen hostaccounts geregistreerd.</p>
            ) : (
                <ul className="spelerlijst">
                    {gebruikers.map((gebruiker) => (
                        <li key={gebruiker.id} className="speler-kaart">
                            <span className="speler-naam">
                                {gebruiker.display_naam}{' '}
                                <span className="dim">@{gebruiker.gebruikersnaam}</span>
                                {!gebruiker.actief && <span className="dim"> · uitgeschakeld</span>}
                            </span>
                            <span className="admin-account-acties">
                                <button className="afspeelknop klein" onClick={() => bewerk(gebruiker)}>
                                    Bewerk
                                </button>
                                <button className="afspeelknop klein" onClick={() => reset(gebruiker)}>
                                    Wachtwoord
                                </button>
                                <button className="afspeelknop klein" onClick={() => wissel(gebruiker)}>
                                    {gebruiker.actief ? 'Uit' : 'Aan'}
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <p className="kaart-label" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
                Gastspelers ({spelers.length})
            </p>
            <p className="dim">Gasten hebben geen account nodig. Deze lijst helpt je zien wie er eerder heeft meegespeeld.</p>
            <ul className="spelerlijst">
                {spelers.map((speler) => (
                    <li key={speler.naam} className="speler-kaart">
                        <span>{speler.naam}{speler.ooit_host && <span className="dim"> · ooit host</span>}</span>
                        <span className="dim">{speler.spellen} spel{speler.spellen === 1 ? '' : 'len'}</span>
                    </li>
                ))}
                {spelers.length === 0 && <li className="dim">Nog geen gastspelers.</li>}
            </ul>
        </section>
    );
}

function NieuweHost({ onKlaar }) {
    const [open, setOpen] = useState(false);
    const [gegevens, setGegevens] = useState({ gebruikersnaam: '', display_naam: '', wachtwoord: '' });
    const [fout, setFout] = useState('');

    async function verstuur(e) {
        e.preventDefault();
        setFout('');
        try {
            await api.adminMaakGebruiker(gegevens);
            setGegevens({ gebruikersnaam: '', display_naam: '', wachtwoord: '' });
            setOpen(false);
            onKlaar();
        } catch (err) {
            setFout(err.message);
        }
    }

    if (!open) {
        return (
            <button className="knop knop-stil" type="button" onClick={() => setOpen(true)}>
                + Hostaccount aanmaken
            </button>
        );
    }
    return (
        <form className="kaart" onSubmit={verstuur} style={{ marginBottom: '1rem' }}>
            {fout && <p className="waarschuwing">{fout}</p>}
            <div className="velden">
                <input className="invoer" required value={gegevens.gebruikersnaam} placeholder="Gebruikersnaam" onChange={(e) => setGegevens({ ...gegevens, gebruikersnaam: e.target.value })} />
                <input className="invoer" required value={gegevens.display_naam} placeholder="Zichtbare naam" onChange={(e) => setGegevens({ ...gegevens, display_naam: e.target.value })} />
                <input className="invoer" required minLength={10} type="password" value={gegevens.wachtwoord} placeholder="Wachtwoord (minimaal 10 tekens)" onChange={(e) => setGegevens({ ...gegevens, wachtwoord: e.target.value })} />
            </div>
            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                <button className="knop" type="submit">Aanmaken</button>
                <button className="knop knop-stil" type="button" onClick={() => setOpen(false)}>Annuleer</button>
            </div>
        </form>
    );
}

const LEEG = {
    naam: '', type: 'film', taal: 'nl', jaar: '', land: '', aliassen: '', genres: '',
    hoofdrollen: '', speelplek: '', tmdb_id: '', toevoeg_reden: '',
    collecties: '', nl_tv_bekend: true, curatie_status: 'goedgekeurd', leeftijdsgrens: 16,
};

function NieuweTitel({ onKlaar }) {
    const [uit, setUit] = useState(false);
    const [f, setF] = useState(LEEG);
    const [fout, setFout] = useState('');

    async function opslaan(e) {
        e.preventDefault();
        try {
            await api.adminMaakTitel(naarPayload(f));
            setF(LEEG);
            setUit(false);
            onKlaar();
        } catch (err) {
            setFout(err.message);
        }
    }

    if (!uit) {
        return (
            <button className="knop knop-stil" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setUit(true)}>
                + Nieuwe titel
            </button>
        );
    }
    return (
        <form className="kaart" style={{ marginTop: '1rem', textAlign: 'left' }} onSubmit={opslaan}>
            {fout && <p className="waarschuwing">{fout}</p>}
            <TitelVelden f={f} setF={setF} />
            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                <button className="knop" type="submit">Toevoegen</button>
                <button className="knop knop-stil" type="button" onClick={() => setUit(false)}>Annuleer</button>
            </div>
        </form>
    );
}

function TitelDetail({ titel, onWijzig }) {
    const [f, setF] = useState(naarForm(titel));
    const [tracks, setTracks] = useState([]);
    const [vragen, setVragen] = useState([]);
    const [melding, setMelding] = useState('');
    const [uploadFile, setUploadFile] = useState(null);
    const [uploadNaam, setUploadNaam] = useState('');
    const [uploadArtiest, setUploadArtiest] = useState('');

    async function laadTracks() {
        setTracks(await api.adminTracks(titel.id));
    }
    async function laadVragen() {
        try { setVragen(await api.adminVragen(titel.id)); } catch { /* leeg */ }
    }
    useEffect(() => {
        laadTracks();
        laadVragen();
        /* eslint-disable-next-line */
    }, [titel.id]);

    async function zetStatus(id, data) {
        await api.adminTrackStatus(id, data);
        laadTracks();
        onWijzig();
    }

    async function bewaar() {
        try {
            await api.adminUpdateTitel(titel.id, naarPayload(f));
            setMelding('Opgeslagen.');
            onWijzig();
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function verwijder() {
        if (!confirm(`Titel "${titel.naam}" verwijderen?`)) return;
        await api.adminVerwijderTitel(titel.id);
        onWijzig();
    }
    async function verwijderTrack(id) {
        await api.adminVerwijderTrack(id);
        laadTracks();
        onWijzig();
    }
    async function downloadTrack(id) {
        try {
            await api.adminDownloadTrack(id);
            setMelding('Track echt gedownload en opgeslagen in /media/downloads voor later gebruik.');
            laadTracks();
            onWijzig();
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function uploadTrack(e) {
        e.preventDefault();
        if (!uploadFile) {
            setMelding('Kies eerst een audiobestand.');
            return;
        }
        try {
            await api.adminUploadTrack(titel.id, uploadFile, {
                tracknaam: uploadNaam.trim() || titel.naam,
                artiest: uploadArtiest.trim() || 'Eigen upload',
            });
            setUploadFile(null);
            setUploadNaam('');
            setUploadArtiest('');
            setMelding('Audio geüpload en als lokale track gekoppeld.');
            laadTracks();
            onWijzig();
        } catch (err) {
            setMelding(err.message);
        }
    }

    return (
        <div className="titel-detail">
            {melding && <p className="dim">{melding}</p>}
            <TitelVelden f={f} setF={setF} />
            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                <button className="knop" onClick={bewaar}>Opslaan</button>
                <button className="knop knop-stil" onClick={verwijder}>Verwijder titel</button>
            </div>

            <p className="kaart-label" style={{ marginTop: '1rem' }}>Tracks</p>
            <ul className="tracklijst">
                {tracks.map((tr, i) => (
                    <li key={tr.id} className={'track' + (tr.werkt ? '' : ' afgekeurd')}>
                        <div className="track-info">
                            <span className="track-naam">
                                {i === 0 && tr.werkt && (
                                    <span className="host-tag">speelt</span>
                                )}{' '}
                                {tr.tracknaam}
                            </span>
                            <span className="dim">
                                {tr.artiest} · {tr.bron} · ★{tr.herkenbaarheid}
                                {Number(tr.verificatie_score) > 0 && ` · controle ${Math.round(Number(tr.verificatie_score) * 100)}%`}
                                {tr.verificatie_reden && ` · ${tr.verificatie_reden}`}
                                {` · gespeeld: ${tr.keer_gespeeld || 0}×`}
                                {tr.download_status && ` · lokaal: ${tr.download_status}`}
                                {tr.fout_aantal > 0 && ` · ${tr.fout_aantal}× gemeld`}
                                {!tr.werkt && ' · afgekeurd'}
                            </span>
                        </div>
                        {tr.bron === 'youtube' ? (
                            <iframe
                                title={tr.tracknaam}
                                width="160"
                                height="90"
                                src={`https://www.youtube.com/embed/${tr.preview_url}?start=${tr.start_seconde || 0}`}
                                allow="encrypted-media"
                                style={{ border: 0, borderRadius: 8 }}
                            />
                        ) : (
                            <audio src={audioBron(tr.preview_url)} controls preload="none" style={{ height: 36, maxWidth: 160 }} />
                        )}
                        <button
                            className="afspeelknop klein"
                            title={tr.werkt ? 'Afkeuren (niet meer spelen)' : 'Weer goedkeuren'}
                            onClick={() => zetStatus(tr.id, { werkt: !tr.werkt })}
                        >
                            {tr.werkt ? '⛔' : '↩'}
                        </button>
                        <button
                            className="afspeelknop klein"
                            title="Markeer als beste (★5)"
                            onClick={() => zetStatus(tr.id, { herkenbaarheid: 5, gecontroleerd: true, werkt: true })}
                        >
                            ★
                        </button>
                        {(tr.bron === 'itunes' || tr.bron === 'youtube') && (
                            <button
                                className="afspeelknop klein"
                                title="Sla deze track lokaal op"
                                onClick={() => downloadTrack(tr.id)}
                            >
                                ⇩
                            </button>
                        )}
                        <button className="afspeelknop klein" onClick={() => verwijderTrack(tr.id)} aria-label="Verwijderen">✕</button>
                    </li>
                ))}
                {tracks.length === 0 && <li className="dim">Nog geen tracks.</li>}
            </ul>

            <form className="kaart admin-bronblok" style={{ marginTop: '1rem' }} onSubmit={uploadTrack}>
                <p className="kaart-label">Eigen audio uploaden</p>
                <p className="dim">Gebruik een eigen of gelicentieerd audiobestand. Dit wordt lokale audio en krijgt voorrang bij het spelen.</p>
                <input className="invoer" type="file" accept="audio/*" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                <div className="zoekbalk" style={{ marginTop: '0.5rem' }}>
                    <input className="invoer" value={uploadNaam} onChange={(e) => setUploadNaam(e.target.value)} placeholder="Tracknaam (optioneel)" />
                    <input className="invoer" value={uploadArtiest} onChange={(e) => setUploadArtiest(e.target.value)} placeholder="Artiest (optioneel)" />
                </div>
                <button className="knop knop-stil" type="submit">Audiobestand koppelen</button>
            </form>

            <p className="kaart-label" style={{ marginTop: '1rem' }}>
                Bonusvragen ({vragen.length})
            </p>
            <ul className="tracklijst">
                {vragen.map((v) => (
                    <li key={v.id} className="track">
                        <div className="track-info">
                            <span className="track-naam">{v.vraag}</span>
                            <span className="dim">
                                {v.soort} · antwoord: {v.opties[v.correct_index]}
                                {v.keer_gebruikt > 0 && ` · ${v.keer_gebruikt}× gebruikt`}
                            </span>
                        </div>
                        <button
                            className="afspeelknop klein"
                            onClick={async () => {
                                await api.adminVerwijderVraag(v.id);
                                laadVragen();
                            }}
                            aria-label="Verwijderen"
                        >
                            ✕
                        </button>
                    </li>
                ))}
                {vragen.length === 0 && (
                    <li className="dim">
                        Nog geen vragen — draai seed/vragen-import.js
                    </li>
                )}
            </ul>

            <YoutubeZoeker titelId={titel.id} onToegevoegd={() => { laadTracks(); onWijzig(); }} />
            <YoutubeToevoegen titelId={titel.id} onToegevoegd={() => { laadTracks(); onWijzig(); }} />
            <TrackZoeker titelId={titel.id} onToegevoegd={() => { laadTracks(); onWijzig(); }} />
        </div>
    );
}

// Zoek automatisch een gecontroleerde YouTube-kandidaat. YouTube is de
// hoofdbron; iTunes staat bewust pas onder deze sectie als fallback.
function YoutubeZoeker({ titelId, onToegevoegd }) {
    const [kandidaat, setKandidaat] = useState(null);
    const [bezig, setBezig] = useState(false);
    const [fout, setFout] = useState('');

    async function zoek() {
        setBezig(true);
        setFout('');
        try {
            setKandidaat(await api.adminZoekYoutube(titelId));
        } catch (err) {
            setKandidaat(null);
            setFout(err.message);
        } finally {
            setBezig(false);
        }
    }

    async function voegToe() {
        if (!kandidaat) return;
        try {
            await api.adminVoegTrack(titelId, kandidaat);
            setKandidaat(null);
            onToegevoegd();
        } catch (err) {
            setFout(err.message);
        }
    }

    return (
        <div className="kaart admin-bronblok" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">1. YouTube — hoofdbron</p>
            <p className="dim">Zoek automatisch de best gecontroleerde intro of titelsong.</p>
            {fout && <p className="waarschuwing">{fout}</p>}
            <button className="knop" type="button" onClick={zoek} disabled={bezig}>
                {bezig ? 'YouTube zoeken…' : 'Beste YouTube-intro zoeken'}
            </button>
            {kandidaat && (
                <div className="youtube-kandidaat">
                    <iframe
                        title={kandidaat.tracknaam}
                        width="100%"
                        height="180"
                        src={`https://www.youtube.com/embed/${kandidaat.preview_url}`}
                        allow="encrypted-media"
                        style={{ border: 0, borderRadius: 8 }}
                    />
                    <p className="track-naam">{kandidaat.tracknaam}</p>
                    <p className="dim">
                        {kandidaat.artiest} · controle {Math.round((kandidaat.verificatie_score || 0) * 100)}%
                        {kandidaat.views != null ? ` · ${kandidaat.views.toLocaleString('nl-NL')} views` : ''}
                    </p>
                    <button className="knop knop-stil" type="button" onClick={voegToe}>
                        YouTube-track opslaan
                    </button>
                </div>
            )}
        </div>
    );
}

// Voeg handmatig een YouTube-track toe.
function YoutubeToevoegen({ titelId, onToegevoegd }) {
    const [url, setUrl] = useState('');
    const [naam, setNaam] = useState('');
    const [start, setStart] = useState('');
    const [fout, setFout] = useState('');

    async function toevoegen(e) {
        e.preventDefault();
        const id = haalVideoId(url);
        if (!id) { setFout('Geen geldige YouTube-link.'); return; }
        if (!naam.trim()) { setFout('Vul de volledige videotitel in, zodat VenTune kan controleren of dit nummer klopt.'); return; }
        try {
            await api.adminVoegTrack(titelId, {
                bron: 'youtube',
                preview_url: id,
                start_seconde: start ? Number(start) : 0,
                tracknaam: naam.trim(),
                artiest: 'YouTube',
            });
            setUrl(''); setNaam(''); setStart(''); setFout('');
            onToegevoegd();
        } catch (err) {
            setFout(err.message);
        }
    }

    return (
        <form onSubmit={toevoegen} style={{ marginTop: '0.75rem' }}>
            <p className="kaart-label">Handmatige YouTube-link</p>
            {fout && <p className="waarschuwing">{fout}</p>}
            <div className="velden">
                <input className="invoer" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube-URL of video-id" />
                <div className="zoekbalk">
                <input className="invoer" value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Volledige videotitel (verplicht)" required />
                    <input className="invoer" value={start} onChange={(e) => setStart(e.target.value)} placeholder="Start (sec)" style={{ maxWidth: 110 }} />
                </div>
                <button className="knop knop-stil" type="submit">YouTube-track toevoegen</button>
            </div>
        </form>
    );
}

// iTunes is alleen fallback als YouTube niets betrouwbaars oplevert.
function TrackZoeker({ titelId, onToegevoegd }) {
    const [term, setTerm] = useState('');
    const [res, setRes] = useState([]);
    const [bezig, setBezig] = useState(false);
    const audioRef = useRef(null);

    async function zoek(e) {
        e.preventDefault();
        setBezig(true);
        try {
            const d = await api.zoekMuziek(term);
            setRes(d.resultaten);
        } catch { setRes([]); } finally { setBezig(false); }
    }
    async function voegToe(r) {
        await api.adminVoegTrack(titelId, {
            bron: 'itunes',
            itunes_track_id: r.itunes_track_id,
            preview_url: r.preview_url,
            tracknaam: r.tracknaam,
            artiest: r.artiest,
            album: r.album,
        });
        setRes([]);
        setTerm('');
        onToegevoegd();
    }

    return (
        <div style={{ marginTop: '0.75rem' }}>
            <form className="zoekbalk" onSubmit={zoek}>
                <input className="invoer" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Fallback: zoek clip op iTunes…" />
                <button className="knop knop-stil" type="submit" disabled={bezig}>{bezig ? '…' : 'Zoek'}</button>
            </form>
            {res.length > 0 && (
                <ul className="tracklijst" style={{ marginTop: '0.5rem' }}>
                    {res.map((r) => (
                        <li key={r.itunes_track_id} className="track">
                            <div className="track-info">
                                <span className="track-naam">{r.tracknaam}</span>
                                <span className="dim">{r.artiest}{r.album ? ` · ${r.album}` : ''}</span>
                            </div>
                            <button className="afspeelknop klein" onClick={() => {
                                if (audioRef.current) { audioRef.current.src = audioBron(r.preview_url); audioRef.current.play(); }
                            }} aria-label="Beluister">▶</button>
                            <button className="knop knop-stil" onClick={() => voegToe(r)}>+</button>
                        </li>
                    ))}
                </ul>
            )}
            <audio ref={audioRef} preload="none" />
        </div>
    );
}

function TitelVelden({ f, setF }) {
    const zet = (k) => (e) => setF({ ...f, [k]: e.target.value });
    return (
        <div className="velden">
            <input className="invoer" value={f.naam} onChange={zet('naam')} placeholder="Naam" />
            <div className="zoekbalk">
                <select className="invoer" value={f.type} onChange={zet('type')}>
                    <option value="film">film</option>
                    <option value="serie">serie</option>
                    <option value="muziek">muziek</option>
                </select>
                <select className="invoer" value={f.taal} onChange={zet('taal')}>
                    <option value="nl">nl</option>
                    <option value="en">en</option>
                </select>
                <input className="invoer" value={f.jaar} onChange={zet('jaar')} placeholder="Jaar" style={{ maxWidth: 90 }} />
            </div>
            <input className="invoer" value={f.land} onChange={zet('land')} placeholder="Land" />
            <input className="invoer" value={f.speelplek} onChange={zet('speelplek')} placeholder="Waar speelt het zich af? (optioneel)" />
            <input className="invoer" value={f.aliassen} onChange={zet('aliassen')} placeholder="Aliassen (komma-gescheiden)" />
            <input className="invoer" value={f.genres} onChange={zet('genres')} placeholder="Genres (komma-gescheiden)" />
            <input className="invoer" value={f.hoofdrollen} onChange={zet('hoofdrollen')} placeholder="Hoofdrollen (komma-gescheiden, optioneel)" />
            <input className="invoer" value={f.tmdb_id} onChange={zet('tmdb_id')} placeholder="TMDB-id (optioneel, voor bonus)" />
            <input className="invoer" value={f.toevoeg_reden} onChange={zet('toevoeg_reden')} placeholder="Waarom staat deze titel in de database?" />
            <input className="invoer" value={f.collecties} onChange={zet('collecties')} placeholder="Spelcollecties (komma-gescheiden: disney, pixar, marvel)" />
            <div className="zoekbalk">
                <select className="invoer" value={f.curatie_status} onChange={zet('curatie_status')}>
                    <option value="goedgekeurd">Goedgekeurd</option>
                    <option value="te_beoordelen">Te beoordelen</option>
                    <option value="uitgesloten">Uitgesloten</option>
                </select>
                <select className="invoer" value={f.leeftijdsgrens} onChange={zet('leeftijdsgrens')}>
                    {[0, 6, 10, 12, 16, 18].map((leeftijd) => <option key={leeftijd} value={leeftijd}>{leeftijd === 0 ? 'Alle leeftijden' : `${leeftijd}+`}</option>)}
                </select>
            </div>
            <label className="keuze klein keuze-schakelaar">
                <input type="checkbox" checked={f.nl_tv_bekend} onChange={(e) => setF({ ...f, nl_tv_bekend: e.target.checked })} />
                <span><strong>Bekend van Nederlandse tv</strong><span className="keuze-uitleg">Zonder dit vinkje valt de titel uit de standaardselectie</span></span>
            </label>
        </div>
    );
}

// --- Hulp: form <-> payload ---
function naarForm(t) {
    return {
        naam: t.naam || '',
        type: t.type || 'film',
        taal: t.taal || 'nl',
        jaar: t.jaar || '',
        land: t.land || '',
        speelplek: t.speelplek || '',
        aliassen: (t.aliassen || []).join(', '),
        genres: (t.genres || []).join(', '),
        hoofdrollen: (t.hoofdrollen || []).join(', '),
        tmdb_id: t.tmdb_id || '',
        toevoeg_reden: t.toevoeg_reden || '',
        collecties: (t.collecties || []).join(', '),
        nl_tv_bekend: t.nl_tv_bekend !== false,
        curatie_status: t.curatie_status || 'goedgekeurd',
        leeftijdsgrens: t.leeftijdsgrens ?? 16,
    };
}
function naarPayload(f) {
    const lijst = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    return {
        naam: f.naam.trim(),
        type: f.type,
        taal: f.taal,
        jaar: f.jaar ? Number(f.jaar) : null,
        land: f.land.trim() || null,
        speelplek: f.speelplek.trim() || null,
        aliassen: lijst(f.aliassen),
        genres: lijst(f.genres),
        hoofdrollen: lijst(f.hoofdrollen),
        tmdb_id: f.tmdb_id ? Number(f.tmdb_id) : null,
        toevoeg_reden: f.toevoeg_reden.trim(),
        collecties: lijst(f.collecties),
        nl_tv_bekend: !!f.nl_tv_bekend,
        curatie_status: f.curatie_status,
        leeftijdsgrens: Number(f.leeftijdsgrens),
    };
}
