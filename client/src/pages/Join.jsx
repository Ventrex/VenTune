import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { checkLobby, joinLobby } from '../lib/api.js';
import { bewaarSessie } from '../lib/sessie.js';

// Joinpagina (/join/:code). Bereikt via QR-scan of code intypen.
// Controleert de lobby, vraagt een naam, en laat je meedoen.
export default function Join() {
    const { code } = useParams();
    const navigate = useNavigate();
    const bovenCode = (code || '').toUpperCase();

    const [status, setStatus] = useState('controleren'); // controleren | ok | weg
    const [naam, setNaam] = useState('');
    const [bezig, setBezig] = useState(false);
    const [fout, setFout] = useState('');

    useEffect(() => {
        checkLobby(bovenCode)
            .then((info) => {
                if (info.bestaat && info.kan_joinen) setStatus('ok');
                else if (info.bestaat) {
                    setStatus('weg');
                    setFout('Dit spel is al begonnen.');
                } else {
                    setStatus('weg');
                    setFout('Deze lobby bestaat niet (meer).');
                }
            })
            .catch(() => {
                setStatus('weg');
                setFout('Kon de lobby niet controleren.');
            });
    }, [bovenCode]);

    async function meedoen(e) {
        e.preventDefault();
        if (!naam.trim()) {
            setFout('Vul een naam in.');
            return;
        }
        setBezig(true);
        setFout('');
        try {
            const res = await joinLobby(bovenCode, naam.trim());
            bewaarSessie({
                token: res.token,
                code: res.code,
                spelerId: res.spelerId,
                is_host: false,
            });
            navigate('/lobby');
        } catch (err) {
            setFout(err.message);
            setBezig(false);
        }
    }

    return (
        <main className="scherm">
            <h1>Meedoen</h1>
            <p className="ondertitel">
                Lobby <span className="code-inline">{bovenCode}</span>
            </p>

            {fout && <p className="waarschuwing">{fout}</p>}

            {status === 'controleren' && <p className="dim">Lobby controleren…</p>}

            {status === 'ok' && (
                <form onSubmit={meedoen} className="stapel">
                    <input
                        className="invoer"
                        value={naam}
                        onChange={(e) => setNaam(e.target.value)}
                        placeholder="Je naam"
                        maxLength={24}
                        aria-label="Je naam"
                        autoFocus
                    />
                    <button className="knop" type="submit" disabled={bezig}>
                        {bezig ? 'Meedoen…' : 'Meedoen'}
                    </button>
                </form>
            )}

            {status === 'weg' && (
                <p style={{ marginTop: '1.5rem' }}>
                    <Link className="terug" to="/">
                        ← Terug naar start
                    </Link>
                </p>
            )}
        </main>
    );
}
