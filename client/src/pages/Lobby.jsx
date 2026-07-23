import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { haalSocket } from '../lib/socket.js';
import { leesSessie, wisSessie } from '../lib/sessie.js';

// Lobby-wachtruimte. Host ziet de QR-code + code; iedereen ziet de live
// spelerslijst. Herstelt automatisch na disconnect via het sessie-token.
export default function Lobby() {
    const navigate = useNavigate();
    const [sessie] = useState(() => leesSessie());
    const [spelers, setSpelers] = useState([]);
    const [fout, setFout] = useState('');
    const [verbonden, setVerbonden] = useState(false);

    useEffect(() => {
        if (!sessie || !sessie.token) {
            navigate('/');
            return;
        }

        const socket = haalSocket();

        const bijVerbinding = () => {
            setVerbonden(true);
            socket.emit('lobby:hallo', { token: sessie.token });
        };
        const bijSpelers = (lijst) => setSpelers(lijst);
        const bijFout = ({ melding }) => setFout(melding);
        const bijVerbroken = () => setVerbonden(false);

        socket.on('connect', bijVerbinding);
        socket.on('lobby:spelers', bijSpelers);
        socket.on('lobby:fout', bijFout);
        socket.on('disconnect', bijVerbroken);

        // Als de socket al verbonden is, meteen hallo zeggen.
        if (socket.connected) bijVerbinding();

        return () => {
            socket.off('connect', bijVerbinding);
            socket.off('lobby:spelers', bijSpelers);
            socket.off('lobby:fout', bijFout);
            socket.off('disconnect', bijVerbroken);
        };
    }, [sessie, navigate]);

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    if (!sessie) return null;

    const joinUrl = `${window.location.origin}/join/${sessie.code}`;

    return (
        <main className="scherm">
            <h1>Lobby</h1>

            {fout && <p className="waarschuwing">{fout}</p>}
            {!verbonden && !fout && (
                <p className="dim">Verbinden met de lobby…</p>
            )}

            {sessie.is_host && (
                <div className="kaart host-kaart">
                    <p className="kaart-label">Deel deze code of QR</p>
                    <p className="lobby-code">{sessie.code}</p>
                    <div className="qr-doos">
                        <QRCodeSVG
                            value={joinUrl}
                            size={200}
                            bgColor="#000000"
                            fgColor="#f5f5f5"
                            level="M"
                            includeMargin
                        />
                    </div>
                    <p className="dim" style={{ wordBreak: 'break-all' }}>
                        {joinUrl}
                    </p>
                </div>
            )}

            {!sessie.is_host && (
                <p className="ondertitel">
                    Je zit in lobby{' '}
                    <span className="code-inline">{sessie.code}</span>. Wachten op
                    de host…
                </p>
            )}

            <div className="stapel" style={{ marginTop: '1.5rem' }}>
                <p className="kaart-label" style={{ textAlign: 'left' }}>
                    Spelers ({spelers.length})
                </p>
                <ul className="spelerlijst">
                    {spelers.map((s) => (
                        <li
                            key={s.id}
                            className={
                                'speler-kaart' +
                                (s.id === sessie.spelerId ? ' actief' : '') +
                                (s.verbonden ? '' : ' weg')
                            }
                        >
                            <span className="speler-naam">
                                {s.naam}
                                {s.is_host && <span className="host-tag">host</span>}
                            </span>
                            {!s.verbonden && (
                                <span className="dim">verbinding kwijt…</span>
                            )}
                        </li>
                    ))}
                </ul>
            </div>

            {sessie.is_host && (
                <div className="stapel" style={{ marginTop: '1.5rem' }}>
                    <button className="knop" disabled title="Komt in de volgende stap">
                        Start spel (binnenkort)
                    </button>
                </div>
            )}

            <p style={{ marginTop: '2rem' }}>
                <button className="terug als-link" onClick={verlaten}>
                    Lobby verlaten
                </button>
            </p>
        </main>
    );
}
