import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { haalChangelog } from '../lib/api.js';

// Publieke changelog: spelers zien de release-informatie uit CHANGELOG.md.
// Zet daarom geen geheimen of operationele details in dat bestand.
export default function Changelog() {
    const [entries, setEntries] = useState([]);
    const [fout, setFout] = useState('');
    const [doelgroep, setDoelgroep] = useState('publiek');

    useEffect(() => {
        haalChangelog(doelgroep).then(setEntries).catch((err) => setFout(err.message));
    }, [doelgroep]);

    return (
        <main className="scherm">
            <p style={{ textAlign: 'left', margin: '0 0 0.5rem' }}>
                <Link className="terug" to="/">← Terug</Link>
            </p>
            <h1>Wat is nieuw?</h1>
            <p className="ondertitel">VenTune-updates voor spelers</p>
            <div className="chips" style={{ justifyContent: 'center' }}>
                <button className={'chip' + (doelgroep === 'publiek' ? ' gekozen' : '')} onClick={() => setDoelgroep('publiek')}>Spelers & host</button>
                <button className={'chip' + (doelgroep === 'alles' ? ' gekozen' : '')} onClick={() => setDoelgroep('alles')}>Alles</button>
            </div>

            {fout && <p className="waarschuwing">{fout}</p>}
            {!fout && entries.length === 0 && <p className="dim">Changelog laden…</p>}

            <div className="stapel changelog-lijst">
                {entries.map((entry) => (
                    <article className="kaart changelog-kaart" key={`${entry.versie}-${entry.datum}`}>
                        <p className="kaart-label">Versie {entry.versie}{entry.datum ? ` · ${entry.datum}` : ''}</p>
                        {entry.secties.map((sectie) => (
                            <section key={sectie.titel}>
                            <h2>{sectie.titel} <span className="dim">· {sectie.doelgroep}</span></h2>
                                <ul>
                                    {sectie.punten.map((punt) => <li key={punt}>{punt}</li>)}
                                </ul>
                            </section>
                        ))}
                    </article>
                ))}
            </div>
        </main>
    );
}
