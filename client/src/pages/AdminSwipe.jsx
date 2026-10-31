import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';

// =====================================================================
// Tweetraps-swipe:
//   Ronde 1 (blind): hoor het nummer zonder naam → herken je het?
//       ja  → goed, wordt gedownload.
//       nee → gaat naar ronde 2.
//   Ronde 2 (met naam): hoor het nog eens mét de titel → goed / fout / onbekend.
//       goed     → wordt gedownload.
//       fout     → AI zoekt later het juiste nummer.
//       onbekend → anderen beluisteren het via de review-link.
// =====================================================================

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }
async function haal(pad, opties = {}) {
    const r = await fetch(pad, { credentials: 'include', ...opties });
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error((d && d.fout) || 'Er ging iets mis.');
    return d;
}
const jsonBody = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export default function AdminSwipe() {
    const [fase, setFase] = useState('blind');       // blind | naam
    const [soort, setSoort] = useState('film_serie');
    const [kaarten, setKaarten] = useState([]);
    const [index, setIndex] = useState(0);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioFout, setAudioFout] = useState('');
    const [laadt, setLaadt] = useState(true);
    const [sleep, setSleep] = useState({ dx: 0, actief: false });
    const start = useRef(null);
    const speler = useRef(null);
    const [voorbereiden, setVoorbereiden] = useState(null);
    const [magAfspelen, setMagAfspelen] = useState(false);

    async function laad() {
        setLaadt(true);
        try {
            const lijst = await haal(`/api/admin/aanbevelingen?soort=${soort}&fase=${fase}`);
            setKaarten(lijst); setIndex(0);
        } catch { setKaarten([]); }
        setLaadt(false);
    }
    useEffect(() => { laad(); /* eslint-disable-next-line */ }, [soort, fase]);

    useEffect(() => {
        if (!kaarten.length) { setVoorbereiden(null); return; }
        let actief = true;
        let timer;
        setVoorbereiden({ bezig: true, klaar: 0, totaal: kaarten.length, fouten: 0 });
        const poll = async () => {
            try {
                const status = await haal(`/api/admin/aanbevelingen/voorbereiden/status?soort=${soort}&fase=${fase}`);
                if (!actief) return;
                setVoorbereiden(status);
                if (!status.bezig) clearInterval(timer);
            } catch (err) {
                if (actief) setVoorbereiden({ bezig: false, fout: err.message, fouten: 1 });
                clearInterval(timer);
            }
        };
        haal('/api/admin/aanbevelingen/voorbereiden', {
            method: 'POST', ...jsonBody({ soort, fase }),
        }).then(() => { if (actief) { poll(); timer = setInterval(poll, 2000); } })
          .catch((err) => { if (actief) setVoorbereiden({ bezig: false, fout: err.message, fouten: 1 }); });
        return () => { actief = false; clearInterval(timer); };
    }, [kaarten, soort, fase]);

    const huidige = kaarten[index];
    const klaar = !laadt && !huidige;

    useEffect(() => {
        setAudioUrl(null);
        setAudioFout('');
        setMagAfspelen(false);
        if (!huidige || voorbereiden?.bezig) return;
        let actief = true;
        haal('/api/admin/aanbevelingen/' + huidige.id + '/audio')
            .then((d) => { if (actief) setAudioUrl(d.audioUrl || null); })
            .catch((e) => { if (actief) setAudioFout(e.message); });
        return () => { actief = false; };
    }, [huidige, voorbereiden?.bezig]);

    async function swipe(keuze) {
        if (!huidige || !audioUrl || audioFout || voorbereiden?.bezig || !magAfspelen) return;
        const id = huidige.id;
        setSleep({ dx: 0, actief: false });
        setIndex((i) => i + 1);
        try {
            await haal('/api/admin/aanbevelingen/' + id + '/swipe', {
                method: 'POST', ...jsonBody({ keuze, fase }),
            });
        } catch { /* kaart is al weg */ }
    }

    // Sleep (alleen in blind-fase: rechts=herken, links=niet).
    function omlaag(x) { if (fase !== 'blind') return; start.current = x; setSleep({ dx: 0, actief: true }); }
    function beweeg(x) { if (start.current != null) setSleep({ dx: x - start.current, actief: true }); }
    function omhoog() {
        if (start.current == null) return;
        const dx = sleep.dx; start.current = null;
        if (dx > 90) swipe('herkend');
        else if (dx < -90) swipe('niet');
        else setSleep({ dx: 0, actief: false });
    }

    return (
        <main className="scherm admin-swipe">
            <div className="ai-kop">
                <Brand link compact />
                <Link className="terug" to="/admin/ai">← AI-beheer</Link>
            </div>

            {/* Fase-keuze */}
            <div className="swipe-tabs">
                <button className={'knop' + (fase === 'blind' ? '' : ' knop-stil')} onClick={() => setFase('blind')}>
                    1. Blind
                </button>
                <button className={'knop' + (fase === 'naam' ? '' : ' knop-stil')} onClick={() => setFase('naam')}>
                    2. Met naam
                </button>
            </div>
            <div className="swipe-tabs" style={{ marginTop: '-0.5rem' }}>
                <button className={'knop knop-stil' + (soort === 'film_serie' ? ' gekozen-soort' : '')}
                        onClick={() => setSoort('film_serie')} style={{ fontSize: '0.95rem' }}>🎬 Films &amp; series</button>
                <button className={'knop knop-stil' + (soort === 'kerst' ? ' gekozen-soort' : '')}
                        onClick={() => setSoort('kerst')} style={{ fontSize: '0.95rem' }}>🎄 Kerst</button>
            </div>

            <p className="dim swipe-uitleg" style={{ marginTop: 0 }}>
                {fase === 'blind'
                    ? 'Je hoort het nummer zonder titel. Herken je het?'
                    : 'Nu mét de titel erbij. Klopt dit nummer bij de titel?'}
            </p>

            {laadt && <p className="dim">Laden…</p>}
            {voorbereiden?.bezig && <p className="dim">Audio voorbereiden: {voorbereiden.klaar || 0}/{voorbereiden.totaal || kaarten.length} verwerkt…</p>}
            {voorbereiden && !voorbereiden.bezig && voorbereiden.fouten > 0 && <p className="waarschuwing">{voorbereiden.fouten} fragment(en) konden niet worden gedownload. {voorbereiden.eersteFout || voorbereiden.fout}</p>}

            {klaar && (
                <div className="kaart swipe-leeg">
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                        {fase === 'blind' ? 'Alle nieuwe nummers blind beoordeeld! 🎉' : 'Niets meer om met naam te beoordelen 🎉'}
                    </p>
                    <p className="dim">
                        {fase === 'blind'
                            ? 'Ga naar "Met naam" voor de nummers die je niet blind herkende.'
                            : 'Haal nieuwe aanbevelingen op, of laat foute nummers opnieuw zoeken in het AI-beheer.'}
                    </p>
                    <Link className="knop" to={fase === 'blind' ? '#' : '/admin/ai'} onClick={() => fase === 'blind' && setFase('naam')}>
                        {fase === 'blind' ? 'Naar "Met naam"' : 'Naar AI-beheer'}
                    </Link>
                </div>
            )}

            {huidige && (
                <>
                    <p className="dim swipe-teller">Nog {kaarten.length - index} te beoordelen</p>

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
                        {fase === 'blind' && (
                            <>
                                <span className="swipe-stempel goed" style={{ opacity: Math.max(0, sleep.dx / 120) }}>KEN IK</span>
                                <span className="swipe-stempel fout" style={{ opacity: Math.max(0, -sleep.dx / 120) }}>NEE</span>
                            </>
                        )}

                        {/* BLIND: geen titelinfo, alleen een vraagteken + geluid. */}
                        {fase === 'blind' ? (
                            <>
                                <div className="swipe-bek">🎧</div>
                                <h2 className="swipe-titel">Welk nummer is dit?</h2>
                                <p className="swipe-sub">Luister en bepaal of je het herkent.</p>
                            </>
                        ) : (
                            <>
                                <div className="swipe-bek">{huidige.soort === 'kerst' ? '🎄' : (huidige.type === 'serie' ? '📺' : '🎬')}</div>
                                {huidige.soort === 'kerst' ? (
                                    <>
                                        <h2 className="swipe-titel">{huidige.tracknaam}</h2>
                                        <p className="swipe-sub">{huidige.artiest}{huidige.jaar ? ` · ${huidige.jaar}` : ''}</p>
                                    </>
                                ) : (
                                    <>
                                        <h2 className="swipe-titel">{huidige.titel}</h2>
                                        <p className="swipe-sub">{huidige.tracknaam} — {huidige.artiest}{huidige.jaar ? ` · ${huidige.jaar}` : ''}</p>
                                    </>
                                )}
                                {huidige.reden && <p className="swipe-reden">{huidige.reden}</p>}
                            </>
                        )}

                        <div className="swipe-voorbeeld">
                            {!audioUrl && !audioFout && <p className="dim">{voorbereiden?.bezig ? 'Alle luistervoorbeelden voorbereiden…' : 'Luistervoorbeeld laden…'}</p>}
                            {audioFout && <p className="waarschuwing">{audioFout}</p>}
                            {audioUrl && <audio key={audioUrl} ref={speler} controls autoPlay preload="auto" src={audioUrl}
                                style={{ width: '100%' }} onCanPlay={() => { setMagAfspelen(true); speler.current?.play().catch(() => {}); }}
                                onError={() => { setMagAfspelen(false); setAudioFout('MP3 kon niet worden afgespeeld.'); }} />}
                        </div>
                    </div>

                    {/* Knoppen verschillen per fase. */}
                    {fase === 'blind' ? (
                        <div className="swipe-knoppen">
                            <button className="swipe-knop fout" disabled={!magAfspelen || !!audioFout || voorbereiden?.bezig} onClick={() => swipe('niet')} aria-label="Ken ik niet">✕</button>
                            <button className="swipe-knop goed" disabled={!magAfspelen || !!audioFout || voorbereiden?.bezig} onClick={() => swipe('herkend')} aria-label="Ken ik">✓</button>
                        </div>
                    ) : (
                        <div className="swipe-knoppen">
                            <button className="swipe-knop fout" disabled={!magAfspelen || !!audioFout || voorbereiden?.bezig} onClick={() => swipe('fout')} aria-label="Fout">✕</button>
                            <button className="swipe-knop weet" disabled={!magAfspelen || !!audioFout || voorbereiden?.bezig} onClick={() => swipe('onbekend')} aria-label="Onbekend">?</button>
                            <button className="swipe-knop goed" disabled={!magAfspelen || !!audioFout || voorbereiden?.bezig} onClick={() => swipe('goed')} aria-label="Goed">✓</button>
                        </div>
                    )}
                    <p className="dim swipe-uitleg">
                        {fase === 'blind'
                            ? '✓ = ik herken dit (goed). ✕ = nee (komt terug mét naam).'
                            : '✓ = klopt (goed). ✕ = fout nummer. ? = onbekend (anderen beoordelen).'}
                    </p>
                </>
            )}
        </main>
    );
}
