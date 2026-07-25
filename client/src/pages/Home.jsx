import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { haalRanking } from '../lib/api.js';
import Brand from '../components/Brand.jsx';
import { ThemaContext } from '../lib/thema.js';

// Startscherm: nieuw spel maken (host) of meedoen met een code.
export default function Home() {
    const navigate = useNavigate();
    const thema = useContext(ThemaContext);
    const [code, setCode] = useState('');
    const [fout, setFout] = useState('');
    const [ranking, setRanking] = useState([]);

    // Ranglijst over eerdere spellen.
    useEffect(() => {
        haalRanking().then(setRanking).catch(() => {});
    }, []);

    function nieuwSpel() {
        // Een host moet eerst een account hebben; het account-scherm stuurt
        // ingelogde hosts direct door naar het filtermenu.
        navigate('/host/login?return=/setup');
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
            <Brand link={false} />
            <h1>De browser-muziekquiz</h1>
            <p className="ondertitel">{thema.ondertitel || 'Muziekquiz over films en series'}</p>
            <p className="dim start-uitleg">
                Host? Log in of maak een hostaccount. Speler? Doe gratis mee met
                de lobbycode.
            </p>

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

            {ranking.length > 0 && (
                <div style={{ marginTop: '2.5rem' }}>
                    <p className="kaart-label" style={{ textAlign: 'left' }}>
                        Ranglijst
                    </p>
                    <ul className="scorebord">
                        {ranking.slice(0, 10).map((r, i) => (
                            <li
                                key={r.naam}
                                className={'score-rij' + (i === 0 ? ' winnaar' : '')}
                            >
                                <span className="score-plek">{i + 1}</span>
                                <span className="score-naam">
                                    {r.naam}
                                    <span className="dim">
                                        {' '}
                                        · {r.spellen} spel{r.spellen === 1 ? '' : 'len'}
                                    </span>
                                </span>
                                <span className="score-punten">{r.totaal}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <p style={{ marginTop: '2rem' }}>
                <Link className="terug" to="/changelog">
                    Wat is nieuw? →
                </Link>
            </p>

            <p style={{ marginTop: '2.5rem' }}>
                <Link className="terug" to="/muziek">
                    Muziek zoeken (test) →
                </Link>
            </p>
        </main>
    );
}
