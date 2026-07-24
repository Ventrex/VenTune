import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// Startscherm: nieuw spel maken (host) of meedoen met een code.
export default function Home() {
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [fout, setFout] = useState('');

    function nieuwSpel() {
        // Host doorloopt eerst het filtermenu; daar wordt de lobby gemaakt.
        navigate('/setup');
    }

    function meedoen(e) {
        e.preventDefault();
        const schoon = code.trim().toUpperCase();
        if (schoon.length !== 4) {
            setFout('Een lobbycode bestaat uit 4 letters.');
            return;
        }
        navigate(`/join/${schoon}`);
    }

    return (
        <main className="scherm">
            <h1>VenTune</h1>
            <p className="ondertitel">Muziekquiz over films en series</p>

            {fout && <p className="waarschuwing">{fout}</p>}

            <div className="stapel">
                <button className="knop" onClick={nieuwSpel}>
                    Nieuw spel
                </button>

                <form onSubmit={meedoen} className="stapel" style={{ gap: '0.75rem' }}>
                    <label className="kaart-label" style={{ textAlign: 'left' }}>
                        Meedoen met een code
                    </label>
                    <div className="zoekbalk" style={{ margin: 0 }}>
                        <input
                            className="invoer code-invoer"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                            placeholder="ABCD"
                            maxLength={4}
                            autoCapitalize="characters"
                            aria-label="Lobbycode"
                        />
                        <button className="knop knop-stil" type="submit">
                            Meedoen
                        </button>
                    </div>
                </form>
            </div>

            <p style={{ marginTop: '2.5rem' }}>
                <Link className="terug" to="/muziek">
                    Muziek zoeken (test) →
                </Link>
            </p>
        </main>
    );
}
