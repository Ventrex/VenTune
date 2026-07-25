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
    const [open, setOpen] = useState(null); // uitgeklapte titel-id
    const [meldingen, setMeldingen] = useState([]);
    const [overzicht, setOverzicht] = useState(null);
    const [gebruikers, setGebruikers] = useState([]);

    async function laad() {
        try {
            setTitels(await api.adminTitels(zoek));
        } catch (err) {
            setMelding(err.message);
        }
    }
    async function laadMeldingen() {
        try {
            setMeldingen(await api.adminMeldingen());
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
        } catch { /* niet fataal */ }
    }
    useEffect(() => {
        laad();
        laadMeldingen();
        laadOverzicht();
        laadGebruikers();
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

            {melding && <p className="waarschuwing">{melding}</p>}

            {overzicht && (
                <div className="overzicht">
                    <Tegel label="Titels" waarde={overzicht.titels} />
                    <Tegel label="Speelbaar" waarde={overzicht.speelbaar} />
                    <Tegel label="Tracks" waarde={overzicht.tracks} />
                    <Tegel label="Afgekeurd" waarde={overzicht.afgekeurd} />
                    <Tegel label="Vragen" waarde={overzicht.vragen} />
                    <Tegel label="Open meldingen" waarde={overzicht.open_meldingen} />
                    <Tegel label="Cache" waarde={overzicht.cache_regels} />
                </div>
            )}
            {overzicht?.per_bron?.length > 0 && (
                <p className="dim admin-bronnen">
                    Audiobronnen:{' '}
                    {overzicht.per_bron.map((bron) => `${bron.bron}: ${bron.n}`).join(' · ')}
                </p>
            )}

            <Hostaccounts gebruikers={gebruikers} onWijzig={laadGebruikers} />

            <div className="stapel" style={{ marginTop: '1rem' }}>
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
                <button
                    className="knop knop-stil"
                    onClick={() => achtergrondTaak(() => api.adminVragenImport(false), api.adminVragenStatus, setBezigVragen, 'Bonusvragen genereren…', 'Bonusvragen genereren klaar.')}
                    disabled={bezigVragen || bezigSeed || bezigPlaylist || bezigTmdb}
                >
                    {bezigVragen ? 'Vragen genereren…' : 'Bonusvragen genereren'}
                </button>
            </div>

            {meldingen.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                    <p className="kaart-label" style={{ textAlign: 'left' }}>
                        Gemelde problemen ({meldingen.length})
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
                                </span>
                                <span style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button
                                        className="afspeelknop klein"
                                        title="Opnieuw zoeken via zoekveld"
                                        onClick={() => { setZoek(m.titel_naam || ''); laad(); }}
                                    >
                                        🔍
                                    </button>
                                    <button
                                        className="afspeelknop klein"
                                        title="Afgehandeld"
                                        onClick={() => meldingAf(m.id)}
                                    >
                                        ✓
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

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
                                <span className="dim"> · {t.type} · {t.taal} · {t.jaar || '—'}</span>
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

function Hostaccounts({ gebruikers, onWijzig }) {
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

    return (
        <section className="admin-accounts">
            <p className="kaart-label" style={{ textAlign: 'left' }}>
                Hostaccounts ({gebruikers.length})
            </p>
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
        </section>
    );
}

const LEEG = { naam: '', type: 'film', taal: 'nl', jaar: '', land: '', aliassen: '', genres: '', tmdb_id: '' };

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
            setMelding('Lokale fallback opgeslagen in /media.');
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
                                {tr.download_status && tr.bron === 'itunes' && ` · download: ${tr.download_status}`}
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
                        {tr.bron === 'itunes' && (
                            <button
                                className="afspeelknop klein"
                                title="Cache deze iTunes-fallback lokaal"
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
                </select>
                <select className="invoer" value={f.taal} onChange={zet('taal')}>
                    <option value="nl">nl</option>
                    <option value="en">en</option>
                </select>
                <input className="invoer" value={f.jaar} onChange={zet('jaar')} placeholder="Jaar" style={{ maxWidth: 90 }} />
            </div>
            <input className="invoer" value={f.land} onChange={zet('land')} placeholder="Land" />
            <input className="invoer" value={f.aliassen} onChange={zet('aliassen')} placeholder="Aliassen (komma-gescheiden)" />
            <input className="invoer" value={f.genres} onChange={zet('genres')} placeholder="Genres (komma-gescheiden)" />
            <input className="invoer" value={f.tmdb_id} onChange={zet('tmdb_id')} placeholder="TMDB-id (optioneel, voor bonus)" />
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
        aliassen: (t.aliassen || []).join(', '),
        genres: (t.genres || []).join(', '),
        tmdb_id: t.tmdb_id || '',
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
        aliassen: lijst(f.aliassen),
        genres: lijst(f.genres),
        tmdb_id: f.tmdb_id ? Number(f.tmdb_id) : null,
    };
}
