import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { haalChangelog } from '../lib/api.js';

// Publieke changelog: spelers zien de release-informatie uit CHANGELOG.md.
// Zet daarom geen geheimen of operationele details in dat bestand.
export default function Changelog() {
    const [entries, setEntries] = useState([]);
    const [fout, setFout] = useState('');
    const [doelgroep, setDoelgroep] = useState('publiek');
    const [dagen, setDagen] = useState(null);
    useEffect(() => {
        fetch('/api/changelog/database').then((r) => r.json()).then((d) => setDagen(d.dagen || [])).catch(() => setDagen([]));
    }, []);

    useEffect(() => {
        haalChangelog('publiek').then(setEntries).catch((err) => setFout(err.message));
    }, []);

    return (
        <main className="scherm">
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <Link className="terug" to="/">← Terug</Link>
            </p>
            <h1>Changelog</h1>
            <div className="chips" style={{ justifyContent: 'center' }}>
                <button className={'chip' + (doelgroep === 'publiek' ? ' gekozen' : '')} onClick={() => setDoelgroep('publiek')}>Nieuw in VenTune</button>
                <button className={'chip' + (doelgroep === 'database' ? ' gekozen' : '')} onClick={() => setDoelgroep('database')}>Database</button>
            </div>
            {doelgroep === 'database' && (
                <div className="stapel changelog-lijst">
                    {dagen === null && <p className="dim">Laden…</p>}
                    {dagen?.length === 0 && <p className="dim">Nog geen wijzigingen bijgehouden.</p>}
                    {(dagen || []).map((dag) => (
                        <article className="kaart changelog-kaart" key={dag.datum}>
                            <p className="kaart-label">{new Date(dag.datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                            <ul>{dag.regels.map((r) => <li key={r}>{r}</li>)}</ul>
                        </article>
                    ))}
                </div>
            )}

            {fout && <p className="waarschuwing">{fout}</p>}
            {doelgroep === 'publiek' && !fout && entries.length === 0 && <p className="dim">Changelog laden…</p>}

            {doelgroep === 'publiek' && <div className="stapel changelog-lijst">
                {entries.map((entry) => (
                    <article className="kaart changelog-kaart" key={`${entry.versie}-${entry.datum}`}>
                        <p className="kaart-label">Versie {entry.versie}{entry.datum ? ` · ${entry.datum}` : ''}</p>
                        {entry.secties.map((sectie) => (
                            <section key={sectie.titel}>
                            {sectie.titel !== 'Wijzigingen' && <h2>{sectie.titel}</h2>}
                                <ul>
                                    {sectie.punten.map((punt) => <li key={punt}>{punt}</li>)}
                                </ul>
                            </section>
                        ))}
                    </article>
                ))}
            </div>}
        </main>
    );
}
