import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';

// =====================================================================
// Tinder-swipe: beoordeel de door ChatGPT aangedragen nummers één voor
// één. Beluister het voorbeeld, veeg of tik: goed / fout / weet niet.
// Bij 'goed' wordt het nummer op de achtergrond gedownload en speelbaar.
// =====================================================================

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }
async function haal(pad, opties = {}) {
    const r = await fetch(pad, { credentials: 'include', ...opties });
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error((d && d.fout) || 'Er ging iets mis.');
    return d;
}

export default function AdminSwipe() {
    const [soort, setSoort] = useState('film_serie');
    const [kaarten, setKaarten] = useState([]);
    const [index, setIndex] = useState(0);
    const [videoId, setVideoId] = useState(null);
    const [laadtVoorbeeld, setLaadtVoorbeeld] = useState(false);
    const [sleep, setSleep] = useState({ dx: 0, actief: false });
    const [klaar, setKlaar] = useState(false);
    const start = useRef(null);

    async function laad(s) {
        try {
            const lijst = await haal('/api/admin/aanbevelingen?soort=' + s);
            setKaarten(lijst); setIndex(0); setKlaar(lijst.length === 0);
        } catch { setKaarten([]); }
    }
    useEffect(() => { laad(soort); /* eslint-disable-next-line */ }, [soort]);

    const huidige = kaarten[index];

    // Voorbeeld ophalen zodra er een nieuwe kaart is.
    useEffect(() => {
        setVideoId(null);
        if (!huidige) return;
        let actief = true;
        setLaadtVoorbeeld(true);
        haal('/api/admin/aanbevelingen/' + huidige.id + '/voorbeeld')
            .then((d) => { if (actief) setVideoId(d.videoId || null); })
            .catch(() => {})
            .finally(() => actief && setLaadtVoorbeeld(false));
        return () => { actief = false; };
    }, [huidige]);

    async function swipe(keuze) {
        if (!huidige) return;
        const id = huidige.id;
        // Optimistisch naar de volgende.
        setSleep({ dx: 0, actief: false });
        setIndex((i) => {
            const next = i + 1;
            if (next >= kaarten.length) setKlaar(true);
            return next;
        });
        try { await haal('/api/admin/aanbevelingen/' + id + '/swipe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keuze }),
        }); } catch { /* stil; kaart is al weg */ }
    }

    // Sleep-gebaren (touch + muis).
    function omlaag(x) { start.current = x; setSleep({ dx: 0, actief: true }); }
    function beweeg(x) { if (start.current != null) setSleep({ dx: x - start.current, actief: true }); }
    function omhoog() {
        if (start.current == null) return;
        const dx = sleep.dx;
        start.current = null;
        if (dx > 90) swipe('goed');
        else if (dx < -90) swipe('fout');
        else setSleep({ dx: 0, actief: false });
    }

    return (
        <main className="scherm admin-swipe">
            <div className="ai-kop">
                <Brand link compact />
                <Link className="terug" to="/admin/ai">← AI-beheer</Link>
            </div>

            <div className="swipe-tabs">
                <button className={'knop' + (soort === 'film_serie' ? '' : ' knop-stil')}
                        onClick={() => setSoort('film_serie')}>🎬 Films &amp; series</button>
                <button className={'knop' + (soort === 'kerst' ? '' : ' knop-stil')}
                        onClick={() => setSoort('kerst')}>🎄 Kerst</button>
            </div>

            {klaar && (
                <div className="kaart swipe-leeg">
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>Alles beoordeeld! 🎉</p>
                    <p className="dim">Haal nieuwe aanbevelingen op in het AI-beheer, of wissel van categorie.</p>
                    <Link className="knop" to="/admin/ai">Naar AI-beheer</Link>
                </div>
            )}

            {!klaar && huidige && (
                <>
                    <p className="dim swipe-teller">
                        Nog {kaarten.length - index} te beoordelen
                    </p>

                    <div
                        className="swipe-kaart"
                        style={{
                            transform: `translateX(${sleep.dx}px) rotate(${sleep.dx / 20}deg)`,
                            transition: sleep.actief ? 'none' : 'transform 0.25s ease',
                        }}
                        onTouchStart={(e) => omlaag(e.touches[0].clientX)}
                        onTouchMove={(e) => beweeg(e.touches[0].clientX)}
                        onTouchEnd={omhoog}
                        onMouseDown={(e) => omlaag(e.clientX)}
                        onMouseMove={(e) => start.current != null && beweeg(e.clientX)}
                        onMouseUp={omhoog}
                        onMouseLeave={omhoog}
                    >
                        {/* Veeg-hints */}
                        <span className="swipe-stempel goed" style={{ opacity: Math.max(0, sleep.dx / 120) }}>GOED</span>
                        <span className="swipe-stempel fout" style={{ opacity: Math.max(0, -sleep.dx / 120) }}>FOUT</span>

                        <div className="swipe-bek">
                            {huidige.soort === 'kerst' ? '🎄' : (huidige.type === 'serie' ? '📺' : '🎬')}
                        </div>

                        {huidige.soort === 'kerst' ? (
                            <>
                                <h2 className="swipe-titel">{huidige.tracknaam}</h2>
                                <p className="swipe-sub">{huidige.artiest}{huidige.jaar ? ` · ${huidige.jaar}` : ''}</p>
                            </>
                        ) : (
                            <>
                                <h2 className="swipe-titel">{huidige.titel}</h2>
                                <p className="swipe-sub">
                                    {huidige.tracknaam} — {huidige.artiest}
                                    {huidige.jaar ? ` · ${huidige.jaar}` : ''}
                                </p>
                            </>
                        )}

                        {huidige.reden && <p className="swipe-reden">{huidige.reden}</p>}

                        <div className="swipe-bekend">
                            Bekendheid: {'★'.repeat(huidige.bekendheid)}{'☆'.repeat(5 - huidige.bekendheid)}
                        </div>

                        {/* Voorbeeld beluisteren (YouTube). Draait alleen op de echte site. */}
                        <div className="swipe-voorbeeld">
                            {laadtVoorbeeld && <p className="dim">Voorbeeld zoeken…</p>}
                            {!laadtVoorbeeld && videoId && (
                                <iframe
                                    title="Voorbeeld"
                                    width="100%" height="80"
                                    src={`https://www.youtube.com/embed/${videoId}?rel=0`}
                                    frameBorder="0"
                                    allow="autoplay; encrypted-media"
                                    allowFullScreen
                                />
                            )}
                            {!laadtVoorbeeld && !videoId && <p className="dim">Geen voorbeeld gevonden.</p>}
                        </div>
                    </div>

                    <div className="swipe-knoppen">
                        <button className="swipe-knop fout" onClick={() => swipe('fout')} aria-label="Fout">✕</button>
                        <button className="swipe-knop weet" onClick={() => swipe('weet_niet')} aria-label="Weet niet">?</button>
                        <button className="swipe-knop goed" onClick={() => swipe('goed')} aria-label="Goed">✓</button>
                    </div>
                    <p className="dim swipe-uitleg">
                        Veeg naar rechts of tik ✓ = goed (wordt gedownload). Links of ✕ = fout. ? = weet niet.
                    </p>
                </>
            )}
        </main>
    );
}
