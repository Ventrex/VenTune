import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import { authInloggen, authRegistreren, authSessie } from '../lib/api.js';

// Hostaccounts zijn verplicht om een lobby te maken. Spelers blijven gasten.
export default function HostAuth() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [modus, setModus] = useState('inloggen');
    const [gebruiker, setGebruiker] = useState('');
    const [displayNaam, setDisplayNaam] = useState('');
    const [wachtwoord, setWachtwoord] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);

    const gewensteVervolg = params.get('return') || '/setup';
    const vervolg = gewensteVervolg.startsWith('/') ? gewensteVervolg : '/setup';

    useEffect(() => {
        authSessie().then((s) => {
            if (s.ingelogd) navigate(vervolg, { replace: true });
        }).catch(() => {});
    }, [navigate, vervolg]);

    async function verstuur(e) {
        e.preventDefault();
        setFout('');
        setBezig(true);
        try {
            if (modus === 'registreren') {
                await authRegistreren({
                    gebruikersnaam: gebruiker,
                    display_naam: displayNaam || gebruiker,
                    wachtwoord,
                });
            } else {
                await authInloggen({ gebruikersnaam: gebruiker, wachtwoord });
            }
            navigate(vervolg, { replace: true });
        } catch (err) {
            setFout(err.message);
        } finally {
            setBezig(false);
        }
    }

    return (
        <main className="scherm auth-scherm">
            <Brand link={false} />
            <h1>{modus === 'inloggen' ? 'Host inloggen' : 'Hostaccount maken'}</h1>
            <p className="ondertitel">
                Een hostaccount is verplicht om een spel te starten. Spelers doen
                gewoon mee zonder account.
            </p>

            {fout && <p className="waarschuwing">{fout}</p>}

            <form onSubmit={verstuur} className="stapel kaart auth-kaart">
                <label className="kaart-label" htmlFor="host-gebruiker">Gebruikersnaam</label>
                <input
                    id="host-gebruiker"
                    className="invoer"
                    value={gebruiker}
                    onChange={(e) => setGebruiker(e.target.value)}
                    autoComplete="username"
                    required
                />
                {modus === 'registreren' && (
                    <>
                        <label className="kaart-label" htmlFor="host-display">Naam op het hostscherm</label>
                        <input
                            id="host-display"
                            className="invoer"
                            value={displayNaam}
                            onChange={(e) => setDisplayNaam(e.target.value)}
                            placeholder="Bijv. Tim"
                            maxLength={40}
                            autoComplete="nickname"
                            required
                        />
                    </>
                )}
                <label className="kaart-label" htmlFor="host-wachtwoord">Wachtwoord</label>
                <input
                    id="host-wachtwoord"
                    className="invoer"
                    type="password"
                    value={wachtwoord}
                    onChange={(e) => setWachtwoord(e.target.value)}
                    minLength={10}
                    autoComplete={modus === 'inloggen' ? 'current-password' : 'new-password'}
                    required
                />
                <button className="knop" type="submit" disabled={bezig}>
                    {bezig ? 'Even geduld…' : modus === 'inloggen' ? 'Inloggen' : 'Account maken'}
                </button>
            </form>

            <button
                className="terug als-link"
                onClick={() => { setFout(''); setModus(modus === 'inloggen' ? 'registreren' : 'inloggen'); }}
            >
                {modus === 'inloggen' ? 'Nog geen hostaccount? Account maken' : 'Ik heb al een account'}
            </button>
            <p style={{ marginTop: '1.5rem' }}>
                <Link className="terug" to="/">← Terug</Link>
            </p>
        </main>
    );
}
