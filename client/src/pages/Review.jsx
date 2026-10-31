import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';

// =====================================================================
// Publieke review-pagina (/review). Deel deze link met vrienden: zij
// horen een nummer blind (zonder titel) en stemmen of ze het herkennen.
// Genoeg herkenning → het nummer wordt automatisch goedgekeurd.
// Geen login nodig; één stem per apparaat per nummer.
// =====================================================================

function stemmerId() {
    try {
        let id = localStorage.getItem('ventune_stemmer');
        if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('ventune_stemmer', id); }
        return id;
    } catch { return 'anon-' + Math.random().toString(36).slice(2); }
}

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }

export default function Review() {
    const stemmer = useRef(stemmerId());
    const [kaart, setKaart] = useState(null);   // {id, videoId} | null
    const [klaar, setKlaar] = useState(false);
    const [laadt, setLaadt] = useState(true);
    const [geteld, setGeteld] = useState(0);

    async function volgende() {
        setLaadt(true); setKaart(null);
        try {
            const r = await fetch('/api/review/volgende?stemmer=' + encodeURIComponent(stemmer.current));
            const d = await jsonOfNull(r);
            if (d && d.klaar) { setKlaar(true); setKaart(null); }
            else if (d && d.id) { setKaart(d); setKlaar(false); }
            else setKlaar(true);
        } catch { setKlaar(true); }
        setLaadt(false);
    }
    useEffect(() => { volgende(); /* eslint-disable-next-line */ }, []);

    async function stem(herkend) {
        if (!kaart) return;
        try {
            await fetch('/api/review/' + kaart.id + '/stem', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stemmer: stemmer.current, herkend }),
            });
        } catch { /* */ }
        setGeteld((n) => n + 1);
        volgende();
    }

    return (
        <main className="scherm admin-swipe">
            <div className="ai-kop">
                <Brand link={false} />
            </div>
            <h1 style={{ fontSize: 'clamp(1.6rem,6vw,2.2rem)' }}>Help mee</h1>
            <p className="ondertitel">Hoor je dit nummer wel eens? Jouw stem bepaalt of het in de quiz komt.</p>

            {laadt && <p className="dim">Laden…</p>}

            {klaar && !laadt && (
                <div className="kaart swipe-leeg">
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>Bedankt! 🙏</p>
                    <p className="dim">Je hebt alles beoordeeld wat er nu is{geteld ? ` (${geteld} nummers)` : ''}. Kom later nog eens terug.</p>
                    <Link className="knop" to="/">Naar VenTune</Link>
                </div>
            )}

            {kaart && !laadt && (
                <>
                    <div className="swipe-kaart" style={{ cursor: 'default' }}>
                        <div className="swipe-bek">🎧</div>
                        <h2 className="swipe-titel">Ken je dit nummer?</h2>
                        <p className="swipe-sub">Luister even en stem hieronder.</p>
                        <div className="swipe-voorbeeld">
                            {kaart.videoId
                                ? <iframe title="Voorbeeld" width="100%" height="80"
                                          src={`https://www.youtube.com/embed/${kaart.videoId}?rel=0`}
                                          frameBorder="0" allow="autoplay; encrypted-media" allowFullScreen />
                                : <p className="dim">Geen voorbeeld beschikbaar — sla over.</p>}
                        </div>
                    </div>
                    <div className="swipe-knoppen">
                        <button className="swipe-knop fout" onClick={() => stem(false)} aria-label="Ken ik niet">✕</button>
                        <button className="swipe-knop goed" onClick={() => stem(true)} aria-label="Ken ik">✓</button>
                    </div>
                    <p className="dim swipe-uitleg">✓ = ik ken dit · ✕ = ken ik niet</p>
                    {geteld > 0 && <p className="dim swipe-teller">{geteld} beoordeeld — bedankt!</p>}
                </>
            )}
        </main>
    );
}
