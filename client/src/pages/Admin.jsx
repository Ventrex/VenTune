import React, { useEffect, useState } from 'react';
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
    const [titelFilter, setTitelFilter] = useState('');
    const [titelTaal, setTitelTaal] = useState('');
    const [geselecteerdeTitels, setGeselecteerdeTitels] = useState([]);
    const [melding, setMelding] = useState('');
    const [bezigSeed, setBezigSeed] = useState(false);
    const [bezigPlaylist, setBezigPlaylist] = useState(false);
    const [bezigTmdb, setBezigTmdb] = useState(false);
    const [bezigCatalogus, setBezigCatalogus] = useState(false);
    const [bezigStudio, setBezigStudio] = useState(false);
    const [bezigVragen, setBezigVragen] = useState(false);
    const [bezigDownloads, setBezigDownloads] = useState(false);
    const [bezigHealth, setBezigHealth] = useState(false);
    const [bezigCollecties, setBezigCollecties] = useState(false);
    const [open, setOpen] = useState(null); // uitgeklapte titel-id
    const [meldingen, setMeldingen] = useState([]);
    const [overzicht, setOverzicht] = useState(null);
    const [gebruikers, setGebruikers] = useState([]);
    const [spelers, setSpelers] = useState([]);
    const [ontbrekend, setOntbrekend] = useState([]);
    const [collecties, setCollecties] = useState([]);
    const [tab, setTab] = useState('overzicht');
    const [importGenre, setImportGenre] = useState('');
    const [voortgang, setVoortgang] = useState(null);
    const [kwaliteit, setKwaliteit] = useState(null);
    const [planning, setPlanning] = useState(null);
    const [importPreview, setImportPreview] = useState(null);
    const [meldingGroepen, setMeldingGroepen] = useState([]);
    const [meldingKandidaten, setMeldingKandidaten] = useState({});
    const [taken, setTaken] = useState(null);
    const [vraagSuggesties, setVraagSuggesties] = useState([]);
    const [bezigSuggesties, setBezigSuggesties] = useState(false);

    async function laadTitels(zoekOverride = zoek, filterOverride = titelFilter, taalOverride = titelTaal) {
        try {
            setTitels(await api.adminTitels(zoekOverride, filterOverride, taalOverride));
            setGeselecteerdeTitels([]);
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function laadOntbrekend() {
        try {
            setOntbrekend(await api.adminOntbrekendeTracks());
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function laad(zoekOverride = zoek, filterOverride = titelFilter, taalOverride = titelTaal) {
        await Promise.all([laadTitels(zoekOverride, filterOverride, taalOverride), laadOntbrekend()]);
    }
    async function laadMeldingen() {
        try {
            setMeldingen(await api.adminMeldingen(true));
            setMeldingGroepen(await api.adminMeldingGroepen());
        } catch { /* niet fataal */ }
    }
    async function laadOverzicht() {
        try {
            const data = await api.adminOverzicht();
            setOverzicht(data);
            if (data.fout) setMelding(data.fout);
        } catch (err) {
            setOverzicht({
                titels: 0,
                bekende_titels: 0,
                speelbaar: 0,
                ontbrekende_tracks: 0,
                tracks: 0,
                afgekeurd: 0,
                vragen: 0,
                open_meldingen: 0,
                cache_regels: 0,
                zoek_log_regels: 0,
                per_bron: [],
                fout: err.message,
            });
            setMelding(`Overzicht kon niet worden geladen: ${err.message}`);
        }
    }
    async function laadKwaliteit() {
        try { setKwaliteit(await api.adminKwaliteit()); } catch { /* niet fataal */ }
    }
    async function laadPlanning() {
        try { setPlanning(await api.adminPlanning()); } catch { /* niet fataal */ }
    }
    async function laadTaken() {
        try { setTaken(await api.adminTaken()); } catch { /* oudere serverversie */ }
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
    async function laadVraagSuggesties() {
        try { setVraagSuggesties(await api.adminVraagSuggesties('open')); } catch { /* niet fataal */ }
    }
    useEffect(() => {
        laadOntbrekend();
        laadMeldingen();
        laadOverzicht();
        laadKwaliteit();
        laadPlanning();
        laadTaken();
        laadGebruikers();
        laadCollecties();
        laadVraagSuggesties();
        /* eslint-disable-next-line */
    }, []);
    useEffect(() => {
        if (tab === 'titels') laadTitels();
        /* eslint-disable-next-line */
    }, [tab]);
    useEffect(() => {
        const timer = setInterval(laadTaken, 2500);
        return () => clearInterval(timer);
        /* eslint-disable-next-line */
    }, []);

    async function meldingAf(id) {
        try {
            await api.adminMeldingAf(id);
            await laadMeldingen();
            laadOverzicht();
        } catch (err) { setMelding(err.message); }
    }

    async function verwijderMelding(id) {
        if (!window.confirm('Deze afgehandelde melding definitief verwijderen?')) return;
        try {
            await api.adminVerwijderMelding(id);
            await laadMeldingen();
            laadOverzicht();
        } catch (err) { setMelding(err.message); }
    }

    async function zoekMelding(meldingItem) {
        try {
            const kandidaat = await api.adminMeldingZoek(meldingItem.id);
            setMeldingKandidaten((oud) => ({ ...oud, [meldingItem.id]: kandidaat }));
            setMelding(`Kandidaat gevonden voor ${meldingItem.titel_naam || 'de titel'}; luister hem eerst via YouTube.`);
        } catch (err) { setMelding(err.message); }
    }

    async function koppelMelding(meldingItem) {
        const kandidaat = meldingKandidaten[meldingItem.id];
        if (!kandidaat) return;
        if (!window.confirm(`YouTube-track koppelen aan "${meldingItem.titel_naam}" en goedkeuren?`)) return;
        try {
            await api.adminMeldingKoppel(meldingItem.id, kandidaat);
            setMelding(`Track gekoppeld. ${meldingItem.titel_naam} doet weer mee en kan nu worden gedownload.`);
            setMeldingKandidaten((oud) => { const nieuw = { ...oud }; delete nieuw[meldingItem.id]; return nieuw; });
            await laadMeldingen();
            await Promise.all([laadOverzicht(), laadTitels()]);
        } catch (err) { setMelding(err.message); }
    }

    async function keurMeldingGoed(meldingItem) {
        if (!window.confirm(`Bestaande track voor "${meldingItem.titel_naam}" goedkeuren?`)) return;
        try {
            await api.adminMeldingGoedkeuren(meldingItem.id, meldingItem.track_id);
            setMelding(`Track goedgekeurd. ${meldingItem.titel_naam} doet weer mee.`);
            await laadMeldingen();
            await Promise.all([laadOverzicht(), laadTitels()]);
        } catch (err) { setMelding(err.message); }
    }

    async function keurVraagGoed(suggestie) {
        setBezigSuggesties(true);
        try {
            await api.adminVraagSuggestieGoedkeuren(suggestie.id);
            setMelding(`Bonusvraag voor ${suggestie.titel_naam} goedgekeurd.`);
            await laadVraagSuggesties();
        } catch (err) { setMelding(err.message); }
        finally { setBezigSuggesties(false); }
    }

    async function wijsVraagAf(suggestie) {
        const toelichting = window.prompt('Waarom afwijzen? (optioneel)', '') ?? '';
        setBezigSuggesties(true);
        try {
            await api.adminVraagSuggestieAfwijzen(suggestie.id, toelichting);
            setMelding(`Bonusvraag voor ${suggestie.titel_naam} afgewezen.`);
            await laadVraagSuggesties();
        } catch (err) { setMelding(err.message); }
        finally { setBezigSuggesties(false); }
    }

    async function seed(alleenDb = false, youtubeAlleen = false, force = false) {
        setBezigSeed(true);
        setMelding(alleenDb
            ? 'Alleen ontbrekende database-tracks aanvullen… dit draait in de achtergrond.'
            : 'Seed importeren… dit draait in de achtergrond (1–3 min).');
        try {
            // Force is veilig: importeer vervangt pas nadat een nieuwe,
            // gecontroleerde YouTube-track is gevonden.
            const gestart = await api.adminSeed(force, alleenDb, youtubeAlleen);
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
                        setVoortgang(null);
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
                        setVoortgang(st);
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

    async function zoekEnDownloadOntbrekendeLokale() {
        await achtergrondTaak(
            () => api.adminOntbrekendeLokaleStart(),
            api.adminOntbrekendeLokaleStatus,
            setBezigDownloads,
            'Titels zonder lokale MP3 zoeken op YouTube en downloaden…',
            'Ontbrekende lokale MP3’s verwerken klaar.',
        );
        await Promise.all([laadOverzicht(), laadTitels(), laadOntbrekend()]);
    }

    async function retryDownloads() {
        await achtergrondTaak(
            () => api.adminRetryMislukteDownloads(),
            api.adminDownloadStatus,
            setBezigDownloads,
            'Mislukte downloads opnieuw controleren…',
            'Retry downloads klaar.',
        );
    }

    async function healthcheck() {
        await achtergrondTaak(
            () => api.adminMediaHealthStart(),
            api.adminMediaHealthStatus,
            setBezigHealth,
            'Lokale audiobestanden controleren…',
            'Bestandscontrole klaar.',
        );
        laadOverzicht();
        laadKwaliteit();
    }

    async function bewaarPlanning(data) {
        try {
            setPlanning(await api.adminBewaarPlanning(data));
            setMelding('Automatische beheerplanning opgeslagen.');
        } catch (err) { setMelding(err.message); }
    }

    async function laadPreview() {
        try { setImportPreview(await api.adminImportPreview()); }
        catch (err) { setMelding(err.message); }
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
        setVoortgang(null);
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
                        setVoortgang(null);
                        setMelding(st.fout ? `${klaarTekst} mislukt: ${st.fout}` : tekstVoorTaak(klaarTekst, st.samenvatting));
                        laad();
                        laadOverzicht();
                    } else if (st.bezig && st.totaal) {
                        setVoortgang(st);
                        setMelding(`${bezigTekst} ${st.verwerkt || 0}/${st.totaal}${st.huidige ? ` · ${st.huidige}` : ''}`);
                    } else if (st.bezig) {
                        setVoortgang({ ...st, indeterminate: true });
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

    function openTab(waarde, opties = {}) {
        if (opties.filter !== undefined) setTitelFilter(opties.filter);
        if (opties.zoek !== undefined) setZoek(opties.zoek);
        if (opties.taal !== undefined) setTitelTaal(opties.taal);
        setTab(waarde);
        if (waarde === 'titels') {
            laadTitels(opties.zoek ?? zoek, opties.filter ?? titelFilter, opties.taal ?? titelTaal);
        }
    }

    async function verwijderGeselecteerdeTitels() {
        if (!geselecteerdeTitels.length) return;
        if (!window.confirm(`${geselecteerdeTitels.length} titels definitief verwijderen? Lokale MP3-bestanden van deze titels worden ook verwijderd.`)) return;
        try {
            const res = await api.adminVerwijderTitels(geselecteerdeTitels);
            setMelding(`${res.verwijderd} titels verwijderd · ${res.bestanden_verwijderd || 0} MP3-bestanden verwijderd.`);
            await Promise.all([laadTitels(), laadOverzicht()]);
        } catch (err) { setMelding(err.message); }
    }

    function wisselTitelSelectie(id) {
        setGeselecteerdeTitels((oud) => oud.includes(id) ? oud.filter((x) => x !== id) : [...oud, id]);
    }

    return (
        <main className="scherm host-scherm admin-portaal">
            <Brand compact />
            <div className="raden-kop">
                <h1 style={{ margin: 0 }}>Beheer</h1>
                <button className="terug als-link" onClick={uitloggen}>Uitloggen</button>
            </div>

            <nav className="admin-tabs" aria-label="Adminsecties">
                {[
                    ['overzicht', 'Overzicht'],
                    ['kwaliteit', 'Onderhoud'],
                    ['titels', 'Titels & muziek'],
                    ['import', 'Imports'],
                    ['downloads', 'Downloads'],
                    ['collecties', 'Spelcollecties'],
                    ['vragen', `Bonusvragen${vraagSuggesties.length ? ` (${vraagSuggesties.length})` : ''}`],
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

            {taken && <AdminTaken data={taken} />}
            {melding && <p className="waarschuwing">{melding}</p>}
            {voortgang && (voortgang.totaal || voortgang.indeterminate) && (
                <div className={'admin-progress' + (voortgang.indeterminate ? ' onbepaald' : '')} role="progressbar" aria-valuenow={voortgang.verwerkt || 0} aria-valuemax={voortgang.totaal || 0}>
                    {!voortgang.indeterminate && <span style={{ width: `${Math.min(100, Math.round(((voortgang.verwerkt || 0) / voortgang.totaal) * 100))}%` }} />}
                </div>
            )}

            {tab === 'overzicht' && overzicht && (
                <div className="overzicht">
                    <Tegel label="Titels" waarde={overzicht.titels} onClick={() => openTab('titels', { filter: '' })} />
                    <Tegel label="Films" waarde={overzicht.films} onClick={() => openTab('titels', { filter: 'film' })} />
                    <Tegel label="Series" waarde={overzicht.series} onClick={() => openTab('titels', { filter: 'serie' })} />
                    <Tegel label="Bekend/gecureerd" waarde={overzicht.bekende_titels} onClick={() => openTab('titels', { filter: 'gecurateerd' })} />
                    <Tegel label="Speelbaar" waarde={overzicht.speelbaar} onClick={() => openTab('titels', { filter: 'speelbaar' })} />
                    <Tegel label="Tracks nodig" waarde={overzicht.ontbrekende_tracks} onClick={() => openTab('downloads')} />
                    <Tegel label="Tracks" waarde={overzicht.tracks} onClick={() => openTab('downloads')} />
                    <Tegel label="Afgekeurd" waarde={overzicht.afgekeurd} onClick={() => openTab('titels', { filter: 'afgekeurd' })} />
                    <Tegel label="Vragen" waarde={overzicht.vragen} onClick={() => openTab('titels')} />
                    <Tegel label="Open meldingen" waarde={overzicht.open_meldingen} onClick={() => openTab('meldingen')} />
                    <Tegel label="Cache" waarde={overzicht.cache_regels} onClick={() => openTab('database')} />
                    <Tegel label="Zoeklog" waarde={overzicht.zoek_log_regels} onClick={() => openTab('database')} />
                </div>
            )}
            {tab === 'overzicht' && overzicht?.fout && <p className="waarschuwing">{overzicht.fout}</p>}
            {tab === 'overzicht' && overzicht?.per_bron?.length > 0 && (
                <p className="dim admin-bronnen">
                    Audiobronnen:{' '}
                    {overzicht.per_bron.map((bron) => `${bron.bron}: ${bron.n}`).join(' · ')}
                </p>
            )}

            {tab === 'kwaliteit' && (
                <Kwaliteitsdashboard
                    data={kwaliteit}
                    onRefresh={laadKwaliteit}
                    onHealth={healthcheck}
                    onOntbrekend={zoekEnDownloadOntbrekendeLokale}
                    onVragen={() => achtergrondTaak(() => api.adminVragenImport(true), api.adminVragenStatus, setBezigVragen, 'Bonusvragen controleren en aanvullen…', 'Bonusvragen klaar.')}
                    onStudio={() => achtergrondTaak(() => api.adminStudioImport(), api.adminStudioStatus, setBezigStudio, 'Studio’s controleren…', 'Studio-check klaar.')}
                    onLeeftijd={() => achtergrondTaak(() => api.adminTmdbCatalogus(), api.adminTmdbCatalogusStatus, setBezigCatalogus, 'Leeftijd en catalogus controleren…', 'Leeftijd/catalogus klaar.')}
                    onOpschonen={(actie) => api.adminDatabaseOpschonen(actie).then((r) => setMelding(`${r.verwijderd || 0} verwijderd / opgeschoond.`)).then(() => Promise.all([laadKwaliteit(), laadOverzicht()])).catch((err) => setMelding(err.message))}
                />
            )}

            {tab === 'vragen' && (
                <VraagSuggesties
                    suggesties={vraagSuggesties}
                    bezig={bezigSuggesties}
                    onGoedkeuren={keurVraagGoed}
                    onAfwijzen={wijsVraagAf}
                />
            )}

            {tab === 'users' && <Hostaccounts gebruikers={gebruikers} spelers={spelers} onWijzig={laadGebruikers} />}

            {tab === 'import' && (
                <section className="admin-panel admin-acties" style={{ marginTop: '1rem' }}>
                    <div className="kaart">
                        <p className="kaart-label">Titels en vragen importeren</p>
                        <p className="dim">De database is leidend. Alleen ontbrekende records worden aangevuld; voor MP3’s ga je naar de aparte tab Downloads.</p>
                        <div className="stapel">
                            <button className="knop knop-stil" onClick={() => seed(true, true, false)} disabled={bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen || bezigCatalogus}>
                                {bezigSeed ? 'Bezig…' : 'Database aanvullen · alleen ontbrekende tracks'}
                            </button>
                            <button className="knop knop-stil" onClick={playlistImport} disabled={bezigPlaylist || bezigSeed || bezigTmdb || bezigVragen || bezigCatalogus}>
                                {bezigPlaylist ? 'Playlists importeren…' : 'YouTube-playlists verversen'}
                            </button>
                            <button
                                className="knop knop-stil"
                                onClick={() => achtergrondTaak(api.adminTmdbImport, api.adminTmdbStatus, setBezigTmdb, 'TMDB-titels importeren…', 'TMDB-import klaar.')}
                                disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen || bezigCatalogus}
                            >
                                {bezigTmdb ? 'TMDB importeren…' : 'TMDB-titels importeren'}
                            </button>
                            <button
                                className="knop"
                            onClick={() => achtergrondTaak(api.adminTmdbCatalogus, api.adminTmdbCatalogusStatus, setBezigCatalogus, 'Populaire films en series per jaartal, NL top 10 en Cult Classics opbouwen…', 'Film- en seriecatalogus klaar.')}
                                disabled={bezigCatalogus || bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen}
                            >
                                {bezigCatalogus ? 'Populaire catalogus opbouwen…' : 'Populaire films & series per jaar'}
                            </button>
                            <button
                                className="knop knop-stil"
                                onClick={() => achtergrondTaak(api.adminStudioImport, api.adminStudioStatus, setBezigStudio, 'Ontbrekende studio’s via TMDB aanvullen…', 'Studio’s aanvullen klaar.')}
                                disabled={bezigStudio || bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen || bezigCatalogus}
                            >
                                {bezigStudio ? 'Studio’s aanvullen…' : 'Ontbrekende studio’s aanvullen'}
                            </button>
                            <p className="dim">Alleen films en series: 1980–nu populaire bioscoopfilms (max. 50) en series (max. 25, minimaal 10 als die beschikbaar zijn) per jaar in de Nederlandse regio. Daarnaast 1950–nu de populairste 10 films en series per jaar in Nederland, plus Cult Classics. De aantallen mogen per jaar lager zijn; er worden geen obscure opvultitels toegevoegd. Er wordt hier geen muziek-toplijst gevuld; YouTube zoeken en MP3-downloads blijven aparte tabs.</p>
                            <div className="zoekbalk">
                                <select className="invoer" value={importGenre} onChange={(e) => setImportGenre(e.target.value)} aria-label="Genre voor TMDB-import">
                                    <option value="">Alle genres</option>
                                    {['Actie', 'Avontuur', 'Animatie', 'Komedie', 'Drama', 'Familie', 'Fantasy', 'Horror', 'Musical', 'Romantiek', 'Sciencefiction', 'Thriller', 'Superhelden'].map((g) => <option key={g} value={g}>{g}</option>)}
                                </select>
                                <button className="knop knop-stil" onClick={() => achtergrondTaak(() => api.adminTmdbImport('film', importGenre), api.adminTmdbStatus, setBezigTmdb, 'Nieuwe films ophalen…', 'Nieuwe films ophalen klaar.')} disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen || bezigCatalogus}>
                                    Nieuwe films ophalen{importGenre ? ` · ${importGenre}` : ''}
                                </button>
                                <button className="knop knop-stil" onClick={() => achtergrondTaak(() => api.adminTmdbImport('serie', importGenre), api.adminTmdbStatus, setBezigTmdb, 'Nieuwe series ophalen…', 'Nieuwe series ophalen klaar.')} disabled={bezigTmdb || bezigSeed || bezigPlaylist || bezigVragen || bezigCatalogus}>
                                    Nieuwe series ophalen{importGenre ? ` · ${importGenre}` : ''}
                                </button>
                            </div>
                            <button
                                className="knop knop-stil"
                                onClick={() => achtergrondTaak(() => api.adminVragenImport(false), api.adminVragenStatus, setBezigVragen, 'Bonusvragen genereren…', 'Bonusvragen genereren klaar.')}
                                disabled={bezigVragen || bezigSeed || bezigPlaylist || bezigTmdb || bezigCatalogus}
                            >
                                {bezigVragen ? 'Vragen genereren…' : 'Bonusvragen genereren'}
                            </button>
                        </div>
                        <div className="kaart admin-bronblok" style={{ marginTop: '1rem' }}>
                            <p className="kaart-label">Importpreview</p>
                            <p className="dim">Bekijk vooraf hoeveel lokale seedtitels nieuw zijn, bijgewerkt worden of al gelijk zijn. Er wordt niets aangepast.</p>
                            <button className="knop knop-stil" type="button" onClick={laadPreview}>Preview laden</button>
                            {importPreview && <p className="dim">{importPreview.totaal} items · {importPreview.nieuw} nieuw · {importPreview.bijwerken} bijwerken · {importPreview.behouden} behouden</p>}
                        </div>
                        <div className="kaart" style={{ marginTop: '1rem' }}>
                            <p className="kaart-label">Automatische playlist-refresh</p>
                            <p className="dim">Ververs de ingestelde YouTube-playlists periodiek. Standaard staat dit uit; bestaande veilige matches blijven leidend.</p>
                            <label className="keuze klein keuze-schakelaar">
                                <input
                                    type="checkbox"
                                    checked={planning?.playlistAutomatisch === true}
                                    onChange={(e) => bewaarPlanning({ playlistAutomatisch: e.target.checked, playlistIntervalUren: planning?.playlistIntervalUren || 24 })}
                                />
                                <span><strong>Automatisch verversen</strong><span className="keuze-uitleg">Laatste run: {planning?.playlistLaatsteRun ? new Date(planning.playlistLaatsteRun).toLocaleString() : 'nog niet uitgevoerd'}</span></span>
                            </label>
                            <label className="keuze klein keuze-schakelaar" style={{ marginTop: '0.5rem' }}>
                                <input
                                    type="checkbox"
                                    checked={planning?.mediaHealthAutomatisch !== false}
                                    onChange={(e) => bewaarPlanning({
                                        playlistAutomatisch: planning?.playlistAutomatisch === true,
                                        playlistIntervalUren: planning?.playlistIntervalUren || 24,
                                        mediaHealthAutomatisch: e.target.checked,
                                        mediaHealthIntervalUren: planning?.mediaHealthIntervalUren || 24,
                                    })}
                                />
                                <span><strong>Dagelijkse MP3-bestandscontrole</strong><span className="keuze-uitleg">Controleert hash en aanwezigheid, maar downloadt niets onverwacht</span></span>
                            </label>
                            <p className="kaart-label" style={{ marginTop: '1rem' }}>Dagelijkse gegevensupdates</p>
                            <p className="dim">Nieuwe data komt eerst als <em>te beoordelen</em> binnen. Je kunt elke taak apart aanzetten; standaard staat netwerk-intensieve aanvulling uit.</p>
                            <label className="keuze klein keuze-schakelaar">
                                <input type="checkbox" checked={planning?.tmdbAutomatisch === true} onChange={(e) => bewaarPlanning({ tmdbAutomatisch: e.target.checked })} />
                                <span><strong>Films en series via TMDB bijwerken</strong><span className="keuze-uitleg">Nieuwe titels worden niet automatisch speelbaar</span></span>
                            </label>
                            <label className="keuze klein keuze-schakelaar">
                                <input type="checkbox" checked={planning?.youtubeAutomatisch === true} onChange={(e) => bewaarPlanning({ youtubeAutomatisch: e.target.checked })} />
                                <span><strong>Ontbrekende YouTube-tracks aanvullen</strong><span className="keuze-uitleg">Alleen titels zonder track; onzekere matches worden geweigerd</span></span>
                            </label>
                            <label className="keuze klein keuze-schakelaar">
                                <input type="checkbox" checked={planning?.downloadsAutomatisch === true} onChange={(e) => bewaarPlanning({ downloadsAutomatisch: e.target.checked })} />
                                <span><strong>Gecontroleerde YouTube-tracks downloaden</strong><span className="keuze-uitleg">Alleen al gecontroleerde bronnen naar /media/downloads</span></span>
                            </label>
                            <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                                <label className="kaart-label">Playlists elke <input className="invoer" type="number" min="1" max="168" value={planning?.playlistIntervalUren || 24} onChange={(e) => setPlanning((oud) => ({ ...(oud || {}), playlistIntervalUren: Number(e.target.value) || 24 }))} /> uur</label>
                                <label className="kaart-label">Bestanden elke <input className="invoer" type="number" min="1" max="168" value={planning?.mediaHealthIntervalUren || 24} onChange={(e) => setPlanning((oud) => ({ ...(oud || {}), mediaHealthIntervalUren: Number(e.target.value) || 24 }))} /> uur</label>
                                <label className="kaart-label">Data elke <input className="invoer" type="number" min="1" max="168" value={planning?.tmdbIntervalUren || 24} onChange={(e) => setPlanning((oud) => ({ ...(oud || {}), tmdbIntervalUren: Number(e.target.value) || 24, youtubeIntervalUren: Number(e.target.value) || 24, downloadsIntervalUren: Number(e.target.value) || 24 }))} /> uur</label>
                                <button className="knop knop-stil" type="button" onClick={() => bewaarPlanning({
                                    playlistAutomatisch: true,
                                    mediaHealthAutomatisch: true,
                                    tmdbAutomatisch: true,
                                    youtubeAutomatisch: true,
                                    downloadsAutomatisch: true,
                                    playlistIntervalUren: 24,
                                    mediaHealthIntervalUren: 24,
                                    tmdbIntervalUren: 24,
                                    youtubeIntervalUren: 24,
                                    downloadsIntervalUren: 24,
                                })}>Alles dagelijks aanzetten</button>
                                <button className="knop knop-stil" type="button" onClick={() => bewaarPlanning({ playlistIntervalUren: planning?.playlistIntervalUren || 24, mediaHealthIntervalUren: planning?.mediaHealthIntervalUren || 24, tmdbIntervalUren: planning?.tmdbIntervalUren || 24, youtubeIntervalUren: planning?.youtubeIntervalUren || 24, downloadsIntervalUren: planning?.downloadsIntervalUren || 24 })}>Planning opslaan</button>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {tab === 'downloads' && (
                <section className="admin-panel admin-acties" style={{ marginTop: '1rem' }}>
                    <div className="kaart">
                        <p className="kaart-label">Lokale audio-downloadcentrum</p>
                        <p className="dim">
                            Controleert de YouTube-URL en slaat de volledige audio blijvend op in <code>/media/downloads</code>.
                            Korte iTunes-fragmenten worden geweigerd; eigen m4a-uploads blijven toegestaan.
                        </p>
                        <button className="knop" onClick={() => downloadVooraf()} disabled={bezigDownloads || bezigSeed || bezigPlaylist || bezigTmdb || bezigVragen || bezigCollecties}>
                            {bezigDownloads ? 'Lokale audio controleren/downloaden…' : 'Alle YouTube-audio vooraf downloaden + URL controleren'}
                        </button>
                        <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                            <button className="knop knop-stil" onClick={retryDownloads} disabled={bezigDownloads}>Mislukte downloads opnieuw proberen</button>
                            <button className="knop knop-stil" onClick={healthcheck} disabled={bezigHealth}>{bezigHealth ? 'Bestanden controleren…' : 'Lokale bestanden controleren'}</button>
                        </div>
                        <button className="knop knop-stil" style={{ marginTop: '0.75rem' }} onClick={() => achtergrondTaak(() => api.adminDownloadStart({ controleer: true, alleenGecontroleerd: true, alleenYoutube: true }), api.adminDownloadStatus, setBezigDownloads, 'Gecontroleerde YouTube-tracks vooraf downloaden…', 'Gecontroleerde YouTube-tracks klaar.') } disabled={bezigDownloads}>
                            Alleen gecontroleerde YouTube-tracks downloaden
                        </button>
                        <button className="knop knop-stil" style={{ marginTop: '0.75rem' }} onClick={zoekEnDownloadOntbrekendeLokale} disabled={bezigDownloads}>
                            Ontbrekende lokale audio zoeken + downloaden (max. 250)
                        </button>
                        <div className="zoekbalk" style={{ marginTop: '0.75rem' }}>
                            <button className="knop knop-stil" onClick={() => api.adminAfgekeurdeTracksExport()}>Afgekeurde tracks exporteren</button>
                        </div>
                        {overzicht && <p className="dim" style={{ marginBottom: 0 }}>
                            {overzicht.tracks} tracks · {overzicht.ontbrekende_tracks} titels zonder bruikbare track
                        </p>}
                    </div>
                    <details className="kaart" style={{ marginTop: '1rem' }}>
                        <summary className="kaart-label">Tracks nodig bekijken ({ontbrekend.length})</summary>
                        <p className="dim">Deze titels worden pas speelbaar nadat je een gecontroleerde YouTube-match opslaat of eigen audio uploadt.</p>
                        <ul className="spelerlijst">
                            {ontbrekend.map((t) => (
                                <li key={t.id} className="speler-kaart">
                                    <span className="speler-naam">
                                        {t.naam}
                                        <span className="dim"> · {t.type} · {t.jaar || 'jaar onbekend'}</span>
                                    </span>
                                    <button
                                        className="afspeelknop klein"
                                        onClick={() => { setOpen(t.id); openTab('titels', { zoek: t.naam, filter: '' }); }}
                                    >
                                        Herstellen
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </details>
                </section>
            )}

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
                    {meldingGroepen.length > 0 && (
                        <div className="kaart admin-melding-groepen" style={{ marginBottom: '1rem' }}>
                            <p className="kaart-label">Gegroeerd per titel</p>
                            <ul className="spelerlijst">
                                {meldingGroepen.filter((groep) => groep.open > 0).slice(0, 20).map((groep) => (
                                    <li key={groep.titel_id} className="speler-kaart">
                                        <span>{groep.titel_naam}<span className="dim"> · {groep.open} open · {(groep.soorten || []).join(', ')}</span></span>
                                        <button className="afspeelknop klein" onClick={() => openTab('titels', { zoek: groep.titel_naam, filter: '' })}>Bekijk</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <ul className="spelerlijst">
                        {meldingen.map((m) => (
                            <li key={m.id} className="speler-kaart">
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <span className="speler-naam" style={{ fontSize: '1rem' }}>
                                        {m.titel_naam || '(titel weg)'}
                                        <span className="dim"> · {m.titel_type || 'onbekend'}{m.titel_jaar ? ` · ${m.titel_jaar}` : ''}</span>
                                    </span>
                                    <span className="dim" style={{ display: 'block' }}>
                                        {m.soort.replace('_', ' ')}
                                        {m.tracknaam ? ` · ${m.tracknaam}` : ' · nog geen track gekoppeld'}
                                        {m.track_id && (m.track_werkt ? ' · track actief' : ' · track afgekeurd')}
                                        {m.download_status ? ` · ${m.download_status}` : ''}
                                        {m.toelichting ? ` · ${m.toelichting}` : ''}
                                        {m.afgehandeld ? ' · goedgekeurd' : ' · open'}
                                    </span>
                                </div>
                                <span className="admin-account-acties">
                                    {!m.afgehandeld && <button className="afspeelknop klein" onClick={() => zoekMelding(m)}>YouTube zoeken</button>}
                                    {!m.afgehandeld && m.track_id && <button className="afspeelknop klein" onClick={() => keurMeldingGoed(m)}>Track goedkeuren</button>}
                                    {!m.afgehandeld && meldingKandidaten[m.id] && <button className="afspeelknop klein" onClick={() => koppelMelding(m)}>Koppelen + goedkeuren</button>}
                                    {!m.afgehandeld && !m.track_id && !meldingKandidaten[m.id] && <button className="afspeelknop klein" onClick={() => meldingAf(m.id)}>Sluiten zonder track</button>}
                                    {m.afgehandeld && <button className="afspeelknop klein" onClick={() => verwijderMelding(m.id)}>Verwijderen</button>}
                                </span>
                                {meldingKandidaten[m.id] && (
                                    <span className="dim" style={{ display: 'block', marginTop: '0.5rem' }}>
                                        <strong>Kandidaat:</strong> {meldingKandidaten[m.id].tracknaam} · {meldingKandidaten[m.id].artiest} · <a href={meldingKandidaten[m.id].youtube_url} target="_blank" rel="noreferrer">YouTube beluisteren</a>
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {tab === 'meldingen' && meldingen.length === 0 && (
                <section className="kaart admin-empty" style={{ marginTop: '1.5rem' }}>
                    <p className="kaart-label">Geen meldingen</p>
                    <p className="dim">Er zijn geen open of afgehandelde meldingen gevonden. Een speler kan tijdens een ronde een verkeerd nummer of geen geluid melden; die melding verschijnt hier als herstelkaart.</p>
                </section>
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
                <select className="invoer" value={titelFilter} onChange={(e) => setTitelFilter(e.target.value)} aria-label="Titelfilter">
                    <option value="">Alle titels</option>
                    <option value="zonder-track">Zonder speelbare track</option>
                    <option value="afgekeurd">Met afgekeurde track</option>
                    <option value="speelbaar">Alleen speelbaar</option>
                    <option value="film">Alleen films</option>
                    <option value="serie">Alleen series</option>
                    <option value="lokaal">Heeft lokale MP3</option>
                    <option value="zonder-lokaal">Zonder lokale MP3</option>
                    <option value="studio-ontbreekt">Studio ontbreekt</option>
                    <option value="leeftijd-0">Alle leeftijden</option>
                    <option value="leeftijd-6">Leeftijd 6+</option>
                    <option value="leeftijd-9">Leeftijd 9+</option>
                    <option value="leeftijd-12">Leeftijd 12+</option>
                    <option value="leeftijd-16">Leeftijd 16+</option>
                    <option value="leeftijd-18">Leeftijd 18+</option>
                    <option value="youtube">YouTube-bron</option>
                    <option value="met-melding">Met open melding</option>
                    <option value="gecurateerd">Bekend/gecurateerd</option>
                    <option value="te-beoordelen">Te beoordelen</option>
                    <option value="zonder-vraag">Zonder bonusvraag</option>
                </select>
                <select className="invoer" value={titelTaal} onChange={(e) => setTitelTaal(e.target.value)} aria-label="Taalfilter">
                    <option value="">Alle talen</option>
                    <option value="nl">Nederlands</option>
                    <option value="en">Internationaal</option>
                </select>
                <button className="knop" type="submit">Zoek</button>
            </form>

            {geselecteerdeTitels.length > 0 && (
                <div className="kaart bulk-balk" style={{ marginTop: '0.75rem' }}>
                    <strong>{geselecteerdeTitels.length} geselecteerd</strong>
                    <button className="knop knop-stil gevaar" type="button" onClick={verwijderGeselecteerdeTitels}>
                        Verwijder geselecteerde + MP3
                    </button>
                    <button className="afspeelknop klein" type="button" onClick={() => setGeselecteerdeTitels([])}>Selectie leeg</button>
                </div>
            )}

            {titelFilter === 'zonder-lokaal' && (
                <button className="knop knop-stil" style={{ marginTop: '0.75rem', width: '100%' }} onClick={zoekEnDownloadOntbrekendeLokale} disabled={bezigDownloads}>
                    YouTube zoeken en MP3 downloaden voor deze ontbrekende titels
                </button>
            )}

            <NieuweTitel onKlaar={laadTitels} />

            <p className="kaart-label" style={{ textAlign: 'left', marginTop: '1.5rem' }}>
                Titels ({titels.length})
            </p>
            <p className="dim admin-legenda">Per titel: <span className="bron-pill lokaal">MP3</span> volledig lokaal beschikbaar · <span className="bron-pill youtube">YT</span> wacht nog op download · ⚠ open melding. YouTube is uitsluitend downloadbron; klik een titel voor herstelacties.</p>
            <ul className="spelerlijst">
                {titels.map((t) => (
                    <li key={t.id} className="titel-blok">
                        <div
                            className="titel-rij"
                            onClick={() => setOpen(open === t.id ? null : t.id)}
                        >
                            <input
                                type="checkbox"
                                checked={geselecteerdeTitels.includes(t.id)}
                                onChange={(e) => { e.stopPropagation(); wisselTitelSelectie(t.id); }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`${t.naam} selecteren`}
                            />
                            <span className="speler-naam">
                                {t.naam}
                                <span className="dim"> · {t.type} · {t.taal} · {t.jaar || '—'} · {t.curatie_status || '—'} · {t.leeftijdsgrens ?? 16}+{t.studio ? ` · ${t.studio}` : ' · studio ontbreekt'}{t.collecties?.length ? ` · ${t.collecties.join(', ')}` : ''}</span>
                            </span>
                            <span className="admin-titel-status" aria-label="Audiobronnen">
                                <span className={'bron-pill lokaal' + (!t.lokale_tracks ? ' leeg' : '')}>MP3 {t.lokale_tracks || 0}</span>
                                <span className={'bron-pill youtube' + (!t.youtube_tracks ? ' leeg' : '')}>YT {t.youtube_tracks || 0}</span>
                                {!!t.open_meldingen && <span className="bron-pill melding">⚠ {t.open_meldingen}</span>}
                            </span>
                        </div>
                        {open === t.id && (
                            <TitelDetail titel={t} onWijzig={() => laadTitels()} />
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

function VraagSuggesties({ suggesties, bezig, onGoedkeuren, onAfwijzen }) {
    return (
        <section className="admin-panel" style={{ marginTop: '1rem' }}>
            <div className="kaart">
                <p className="kaart-label">Bonusvragen van spelers ({suggesties.length})</p>
                <p className="dim">Een vraag wordt pas gebruikt nadat je hem goedkeurt. Controleer vooral spelling, juist antwoord en leeftijdsgeschiktheid.</p>
                {suggesties.length === 0 ? (
                    <p className="dim">Geen openstaande suggesties.</p>
                ) : (
                    <ul className="spelerlijst">
                        {suggesties.map((s) => (
                            <li key={s.id} className="speler-kaart" style={{ display: 'block' }}>
                                <strong>{s.titel_naam}</strong>
                                <span className="dim"> · {s.titel_type} · ingestuurd door {s.speler_naam || 'gast'}</span>
                                <p style={{ margin: '0.5rem 0' }}>{s.vraag}</p>
                                <ol style={{ margin: '0 0 0.75rem 1.25rem' }}>
                                    {(s.opties || []).map((optie, i) => (
                                        <li key={i} style={{ color: i === s.correct_index ? 'var(--accent)' : undefined }}>
                                            {optie}{i === s.correct_index ? ' ✓' : ''}
                                        </li>
                                    ))}
                                </ol>
                                <span className="admin-account-acties">
                                    <button className="afspeelknop klein" disabled={bezig} onClick={() => onGoedkeuren(s)}>Goedkeuren</button>
                                    <button className="afspeelknop klein" disabled={bezig} onClick={() => onAfwijzen(s)}>Afwijzen</button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function tekstVoorTaak(klaarTekst, samenvatting) {
    if (!samenvatting || typeof samenvatting !== 'object') return klaarTekst;
    const delen = [];
    if (Number.isFinite(samenvatting.gedownload)) delen.push(`${samenvatting.gedownload} opgeslagen`);
    if (Number.isFinite(samenvatting.overgeslagen)) delen.push(`${samenvatting.overgeslagen} al lokaal`);
    if (Number.isFinite(samenvatting.mislukt) && samenvatting.mislukt) delen.push(`${samenvatting.mislukt} mislukt`);
    return delen.length ? `${klaarTekst} ${delen.join(' · ')}.` : klaarTekst;
}

function AdminTaken({ data }) {
    const lijst = (data.taken || []).filter((taak) => taak.actief || taak.status?.bezig || taak.status?.fout);
    if (!lijst.length) return null;
    return (
        <section className="kaart admin-taken" aria-live="polite" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">Admin-taken</p>
            <p className="dim" style={{ marginTop: 0 }}>
                {data.actieve_taak ? `Bezig: ${data.actieve_taak}` : 'Geen taak meer actief.'}
            </p>
            <ul className="spelerlijst">
                {lijst.map((taak) => {
                    const status = taak.status || {};
                    const percentage = status.totaal ? Math.min(100, Math.round((status.verwerkt || 0) / status.totaal * 100)) : null;
                    return (
                        <li key={taak.naam} className="speler-kaart">
                            <span>
                                <strong>{taak.label}</strong>
                                <span className="dim"> · {status.fout ? `fout: ${status.fout}` : status.bezig ? 'bezig' : 'afgerond'}</span>
                                {status.huidige && <span className="dim"> · {status.huidige}</span>}
                            </span>
                            {percentage !== null && <span className="dim">{percentage}%</span>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function Tegel({ label, waarde, onClick }) {
    const inhoud = (
        <>
            <span className="tegel-waarde">{waarde ?? '—'}</span>
            <span className="tegel-label">{label}</span>
        </>
    );
    if (onClick) {
        return <button type="button" className="tegel klikbaar" onClick={onClick} title={`${label} bekijken`}>{inhoud}</button>;
    }
    return <div className="tegel">{inhoud}</div>;
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

function Kwaliteitsdashboard({ data, onRefresh, onHealth, onOntbrekend, onVragen, onStudio, onLeeftijd, onOpschonen }) {
    const verificatie = data?.verificatie || {};
    const downloadMap = Object.fromEntries((data?.downloads || []).map((r) => [r.download_status || 'onbekend', r.aantal]));
    return (
        <section className="admin-panel" style={{ marginTop: '1rem' }}>
            <div className="kaart">
                <p className="kaart-label">Kwaliteitsdashboard</p>
                <p className="dim">Gebruik dit als onderhoudspaneel: lokale MP3’s controleren, ontbrekende audio aanvullen en metadata repareren.</p>
                <div className="overzicht">
                    <div className="tegel"><span className="tegel-waarde">{verificatie.totaal ?? '—'}</span><span className="tegel-label">Werkende tracks</span></div>
                    <div className="tegel"><span className="tegel-waarde">{verificatie.gecontroleerd ?? '—'}</span><span className="tegel-label">Gecontroleerd</span></div>
                    <div className="tegel"><span className="tegel-waarde">{verificatie.onzeker ?? '—'}</span><span className="tegel-label">Onzeker</span></div>
                    <div className="tegel"><span className="tegel-waarde">{downloadMap.failed ?? 0}</span><span className="tegel-label">Downloadfouten</span></div>
                </div>
                <div className="admin-snelacties">
                    <button className="knop knop-stil" type="button" onClick={onHealth}>Controleer lokale MP3-bestanden</button>
                    <button className="knop knop-stil" type="button" onClick={onOntbrekend}>Zoek YouTube + download ontbrekende MP3’s</button>
                    <button className="knop knop-stil" type="button" onClick={onVragen}>Check bonusvragen</button>
                    <button className="knop knop-stil" type="button" onClick={onStudio}>Studio check</button>
                    <button className="knop knop-stil" type="button" onClick={onLeeftijd}>Leeftijd/catalogus check</button>
                    <button className="knop knop-stil gevaar" type="button" onClick={() => onOpschonen('wees_media')}>MP3 zonder database verwijderen</button>
                    <button className="knop knop-stil" type="button" onClick={onRefresh}>Cijfers vernieuwen</button>
                </div>
            </div>
            <div className="kaart" style={{ marginTop: '1rem' }}>
                <p className="kaart-label">Titels zonder gecontroleerde track ({data?.titels_zonder_gecontroleerde_track?.length || 0})</p>
                <p className="dim">Deze lijst is bewust niet automatisch speelbaar in de modus “alleen gecontroleerd”.</p>
                <ul className="spelerlijst">
                    {(data?.titels_zonder_gecontroleerde_track || []).slice(0, 50).map((titel) => <li className="speler-kaart" key={titel.id}><span>{titel.naam}<span className="dim"> · {titel.type} · {titel.jaar || 'jaar onbekend'} · {titel.tracks} tracks · beste controle {Math.round((Number(titel.beste_score) || 0) * 100)}%</span></span><span className="dim">{(titel.bronnen || []).join(', ') || 'geen bron'} · {titel.open_meldingen || 0} meldingen</span></li>)}
                    {!data && <li className="dim">Kwaliteitsinformatie laden…</li>}
                </ul>
            </div>
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
                <p className="dim">Deze acties ruimen gericht op. Bij weesmedia worden MP3-bestanden verwijderd die niet meer in de database staan.</p>
                <div className="stapel">
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('zoek_cache', 'Alle zoekresultaat-cache verwijderen?')}>Zoekcache leegmaken</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('oude_zoekcache', 'Zoekcache ouder dan 7 dagen verwijderen?')}>Zoekcache ouder dan 7 dagen verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('afgehandelde_meldingen', 'Afgehandelde meldingen verwijderen?')}>Afgehandelde meldingen verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('spelgeschiedenis', 'Alle afgelopen spellen verwijderen?')}>Spelgeschiedenis verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('afgekeurde_tracks', 'Alle afgekeurde tracks uit de database verwijderen?')}>Afgekeurde tracks verwijderen</button>
                    <button className="knop knop-stil gevaar" disabled={bezig} onClick={() => opschonen('wees_media', 'MP3-bestanden verwijderen die niet meer in de database staan?')}>MP3 zonder databasekoppeling verwijderen</button>
                    <button className="knop knop-stil" disabled={bezig} onClick={() => opschonen('onveilige_tekens', 'Onveilige titels en audiometadata uitsluiten? Er wordt niets fysiek verwijderd.')}>Onveilige tekens uitsluiten</button>
                </div>
                <p className="dim" style={{ marginTop: '0.75rem' }}>
                    Deze controleert op Cyrillisch, Arabisch, CJK, controle-tekens en vergelijkbare vervuiling. Een Duitse titel wordt niet op land alleen verwijderd: als hij in de Nederlandse ranglijst thuishoort, mag hij blijven.
                </p>
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
        fontSchaal: 1,
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
                    <select className="invoer" value={thema.fontSchaal} onChange={(e) => zet('fontSchaal', Number(e.target.value))}>
                        <option value="0.9">Kleinere tekst</option>
                        <option value="1">Normale tekst</option>
                        <option value="1.15">Grotere tekst</option>
                        <option value="1.3">Extra grote tekst</option>
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

    async function verwijder(gebruiker) {
        if (!window.confirm(`Hostaccount "${gebruiker.gebruikersnaam}" definitief verwijderen? Sessies worden uitgelogd. Spelgeschiedenis blijft als historie bestaan.`)) return;
        try {
            await api.adminVerwijderGebruiker(gebruiker.id);
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
                                <button className="afspeelknop klein gevaar" onClick={() => verwijder(gebruiker)}>
                                    Verwijder
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
    hoofdrollen: '', speelplek: '', studio: '', tmdb_id: '', toevoeg_reden: '',
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

function trackBronLabel(track) {
    if (track.bron !== 'lokaal') return track.bron;
    const origineel = String(track.bron_url || '').toLowerCase();
    if (origineel.includes('youtube')) return 'youtube → lokaal';
    if (origineel.includes('apple') || origineel.includes('itunes')) return 'itunes → lokaal';
    return 'lokaal';
}

function TitelDetail({ titel, onWijzig }) {
    const [f, setF] = useState(naarForm(titel));
    const [tracks, setTracks] = useState([]);
    const [vragen, setVragen] = useState([]);
    const [melding, setMelding] = useState('');
    const [uploadFile, setUploadFile] = useState(null);
    const [uploadNaam, setUploadNaam] = useState('');
    const [uploadArtiest, setUploadArtiest] = useState('');
    const [downloadBezig, setDownloadBezig] = useState(null);

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
        setDownloadBezig(id);
        setMelding('Download gestart. YouTube wordt gecontroleerd en daarna lokaal opgeslagen…');
        try {
            const gestart = await api.adminDownloadTrack(id);
            if (!gestart?.gestart) {
                setMelding(`Download niet gestart: ${gestart?.taak || 'een andere admin-taak draait al'}.`);
                return;
            }
            for (let poging = 0; poging < 240; poging += 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const status = await api.adminDownloadTrackStatus(id);
                if (!status.klaar) continue;
                if (status.fout) throw new Error(status.fout);
                setMelding('Track gedownload en blijvend opgeslagen in /media/downloads.');
                await laadTracks();
                onWijzig();
                return;
            }
            throw new Error('Download duurt langer dan verwacht. Controleer de Downloads-tab of de meldingen.');
        } catch (err) {
            setMelding(err.message);
        } finally {
            setDownloadBezig(null);
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
                                {tr.artiest} · {trackBronLabel(tr)} · ★{tr.herkenbaarheid}
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
                        {tr.bron === 'youtube' && (
                            <button
                                className="afspeelknop klein"
                                title="Sla deze track lokaal op"
                                disabled={downloadBezig === tr.id}
                                onClick={() => downloadTrack(tr.id)}
                            >
                                {downloadBezig === tr.id ? '…' : '⇩'}
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
        </div>
    );
}

// Zoek automatisch een gecontroleerde YouTube-kandidaat. YouTube is de
// enige automatische audiobron; iTunes-previewclips worden niet gekoppeld.
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
            <input className="invoer" value={f.studio} onChange={zet('studio')} placeholder="Studio / producent (bijv. Disney, Pixar, Marvel)" />
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
                    {[0, 6, 9, 10, 12, 16, 18].map((leeftijd) => <option key={leeftijd} value={leeftijd}>{leeftijd === 0 ? 'Alle leeftijden' : `${leeftijd}+`}</option>)}
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
        studio: t.studio || '',
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
        studio: f.studio.trim() || null,
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
