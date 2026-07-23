import React, { useEffect, useState } from 'react';

// Placeholder-app voor stap 1: bewijst dat client → nginx → server → DB
// werkt door het health-endpoint te bevragen. De echte schermen (Home,
// Setup, Lobby, Host, Play, Score, Admin) komen in de volgende stappen.
export default function App() {
    const [status, setStatus] = useState('bezig met controleren…');

    useEffect(() => {
        fetch('/api/health')
            .then((r) => r.json())
            .then((d) =>
                setStatus(
                    d.status === 'ok'
                        ? 'Server en database bereikbaar ✓'
                        : 'Server bereikbaar, database niet',
                ),
            )
            .catch(() => setStatus('Server niet bereikbaar'));
    }, []);

    return (
        <main style={{ padding: '2rem', textAlign: 'center' }}>
            <h1>VenTune</h1>
            <p style={{ color: 'var(--text-dim)' }}>
                Muziekquiz over films en series
            </p>
            <p style={{ marginTop: '2rem' }}>{status}</p>
        </main>
    );
}
