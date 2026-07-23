import React, { useEffect, useState } from 'react';
import { haalMij, startLogin, logUit } from '../lib/api.js';

// Homepagina voor stap 2: inloggen met Spotify en je eigen profiel zien.
// Toont zonder Premium een nette uitleg over de gastmodus.
export default function Home() {
    const [status, setStatus] = useState('laden'); // laden | uit | in
    const [mij, setMij] = useState(null);
    const [melding, setMelding] = useState('');

    useEffect(() => {
        // Toon een melding op basis van de ?login= parameter uit de callback.
        const params = new URLSearchParams(window.location.search);
        const login = params.get('login');
        if (login === 'geweigerd') setMelding('Je hebt de toegang geweigerd.');
        else if (login === 'mislukt') setMelding('Inloggen mislukt, probeer opnieuw.');
        else if (login === 'fout') setMelding('Er ging iets mis bij het inloggen.');
        if (login) {
            // Maak de URL weer schoon.
            window.history.replaceState({}, '', '/');
        }

        haalMij()
            .then((data) => {
                if (data) {
                    setMij(data);
                    setStatus('in');
                } else {
                    setStatus('uit');
                }
            })
            .catch(() => setStatus('uit'));
    }, []);

    async function uitloggen() {
        await logUit();
        setMij(null);
        setStatus('uit');
    }

    return (
        <main className="scherm">
            <h1>VenTune</h1>
            <p className="ondertitel">Muziekquiz over films en series</p>

            {melding && <p className="waarschuwing">{melding}</p>}

            {status === 'laden' && <p className="dim">Bezig met laden…</p>}

            {status === 'uit' && (
                <div className="stapel">
                    <p className="dim">
                        Log in met je Spotify-account om te beginnen.
                    </p>
                    <button className="knop" onClick={startLogin}>
                        Inloggen met Spotify
                    </button>
                </div>
            )}

            {status === 'in' && mij && (
                <div className="stapel">
                    <div className="kaart">
                        <p className="kaart-label">Ingelogd als</p>
                        <p className="kaart-naam">{mij.weergavenaam}</p>
                        {mij.email && <p className="dim">{mij.email}</p>}
                        <p
                            className={
                                mij.is_premium ? 'badge badge-premium' : 'badge badge-gast'
                            }
                        >
                            {mij.is_premium ? 'Spotify Premium' : 'Geen Premium'}
                        </p>
                    </div>

                    {!mij.is_premium && (
                        <div className="kaart uitleg">
                            <p className="kaart-label">Gastmodus</p>
                            <p>
                                Zonder Spotify Premium kan je telefoon geen muziek
                                afspelen. Je kunt wél meedoen als <strong>gast</strong>:
                                je hoort de muziek van de host in de kamer en raadt
                                gewoon mee.
                            </p>
                        </div>
                    )}

                    <button className="knop knop-stil" onClick={uitloggen}>
                        Uitloggen
                    </button>
                </div>
            )}
        </main>
    );
}
