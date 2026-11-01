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
    if (!r.ok) throw new Error((d && d.fout) || `Serverfout HTTP ${r.status} bij ${pad}.`);
    return d;
}
const jsonBody = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export default function AdminSwipe() {
    const [titelReview, setTitelReview] = useState(false);
    const [zonderMp3, setZonderMp3] = useState(false);
    const [games,setGames]=useState([]);
    const [gameAudio,setGameAudio]=useState('');
    const [gameFout,setGameFout]=useState('');
    const [mp3Kaarten,setMp3Kaarten]=useState([]);
    const [mp3Totaal,setMp3Totaal]=useState(0);
    const [mp3Fout,setMp3Fout]=useState('');
    const [titelKaarten, setTitelKaarten] = useState([]);
    const [titelFout, setTitelFout] = useState('');
    const [titelBezig, setTitelBezig] = useState(null);
    const [fase, setFase] = useState('blind');       // blind | naam
    const [categorie, setCategorie] = useState('film');
    const gameSwipe = categorie === 'games' && !zonderMp3 && !titelReview;
    const categorieen = [['film', 'Films'], ['serie', 'Series'], ['games', 'Videogames'], ['disney', 'Disney'], ['kerst', 'Kerst'], ['rock', 'Rock'], ['80s', '80s'], ['90s', '90s'], ['20s', '20s'], ['kinder', 'Kinder'], ['100nl', '100% NL']];
    const [kaarten, setKaarten] = useState([]);
    const [index, setIndex] = useState(0);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioFout, setAudioFout] = useState('');
    const [laadt, setLaadt] = useState(true);
    const [sleep, setSleep] = useState({ dx: 0, actief: false });
    const start = useRef(null);
    const speler = useRef(null);
    const [magAfspelen, setMagAfspelen] = useState(false);

    async function laad() {
        setLaadt(true);
        try {
            const lijst = await haal(`/api/admin/aanbevelingen?categorie=${categorie}&fase=${fase}`);
            setKaarten(lijst); setIndex(0);
        } catch { setKaarten([]); }
        setLaadt(false);
    }
    useEffect(() => { laad(); /* eslint-disable-next-line */ }, [categorie, fase]);

    async function laadTitelReview() {
        try {
            const lijst = await haal('/api/admin/titels?filter=te-beoordelen');
            setTitelKaarten((lijst || []).filter(t => ['film','serie'].includes(t.type)));
            setTitelFout('');
        } catch (err) { setTitelFout(err.message); }
    }
    useEffect(() => { if (titelReview) laadTitelReview(); }, [titelReview]);
    async function keurTitel(t, status) {
        setTitelBezig(t.id);
        try {
            // Alleen de curatiestatus wijzigen. Geen bestaande titelmetadata overschrijven.
            await haal('/api/admin/titels/' + t.id + '/curatie', {
                method: 'PATCH', ...jsonBody({ status }),
            });
            setTitelKaarten(v => v.filter(x => x.id !== t.id));
        } catch(err) { setTitelFout(err.message); }
        finally { setTitelBezig(null); }
    }

    async function laadZonderMp3() {
        try {
            const r=await haal('/api/admin/swipe/zonder-mp3?type='+categorie);
            setMp3Kaarten(r.kaarten||[]);setMp3Totaal(r.totaal||0);setMp3Fout('');
        }catch(err){setMp3Fout(err.message);}
    }
    useEffect(()=>{if(zonderMp3)laadZonderMp3();},[zonderMp3,categorie]);
    async function prioriteit(t,actie) {
        try {
            await haal('/api/admin/swipe/zonder-mp3/'+t.id,{method:'POST',...jsonBody({actie})});
            await laadZonderMp3();
        } catch(err){setMp3Fout(err.message);}
    }
    async function laadGames() {
        try {setGames(await haal('/api/admin/games/swipe'));setGameFout('');}
        catch(err){setGameFout(err.message);}
    }
    useEffect(()=>{if(gameSwipe)laadGames();},[gameSwipe]);
    useEffect(()=>{
        if(!gameSwipe||!games.length){setGameAudio('');return;}
        let actief=true;
        setGameAudio('');
        haal('/api/admin/games/'+games[0].id+'/audio').then(r=>{if(actief)setGameAudio(r.audioUrl||'');})
          .catch(err=>{if(actief)setGameFout(err.message)});
        return ()=>{actief=false;};
    },[gameSwipe,games[0]?.id]);
    async function beoordeelGame(status) {
        if(!games[0])return;
        try {
            await haal('/api/admin/games/'+games[0].id,{method:'PATCH',...jsonBody({status})});
            setGames(g=>g.slice(1));
        }catch(err){setGameFout(err.message);}
    }
    const huidige = kaarten[index];
    const klaar = !laadt && !huidige;

    // Download op server draait op de achtergrond. Poll zonder lange HTTP-wachttijd.
    useEffect(() => {
        setAudioUrl(null);
        setAudioFout('');
        setMagAfspelen(false);
        if (!huidige) return undefined;
        let actief = true;
        let timer;
        const haalAudio = async () => {
            try {
                const d = await haal('/api/admin/aanbevelingen/' + huidige.id + '/audio');
                if (!actief) return;
                if (d.audioUrl) setAudioUrl(d.audioUrl);
                else if (d.bezig) timer = setTimeout(haalAudio, 1800);
                else setAudioFout('Geen audio-URL van server ontvangen.');
            } catch (err) {
                if (actief) setAudioFout(err.message);
            }
        };
        haalAudio();
        return () => { actief = false; clearTimeout(timer); };
    }, [huidige?.id]);

    // De volgende twee nummers in de downloadwachtrij zetten.
    useEffect(() => {
        kaarten.slice(index + 1, index + 3).forEach((kaart) => {
            haal('/api/admin/aanbevelingen/' + kaart.id + '/audio').catch(() => {});
        });
    }, [kaarten, index]);

    async function swipe(keuze) {
        if (!huidige || (keuze !== 'verkeerde_mp3' && (!audioUrl || audioFout || !magAfspelen))) return;
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

            <div className="swipe-tabs">
                <button className={'knop' + (!titelReview && !zonderMp3 && !gameSwipe ? '' : ' knop-stil')} onClick={() => {setTitelReview(false);setZonderMp3(false);}}>Muziek swipen</button>
                <button className={'knop' + (zonderMp3 ? '' : ' knop-stil')} onClick={() => {setTitelReview(false);setZonderMp3(true);}}>Zonder MP3 · hele database</button>
                <button className={'knop' + (titelReview ? '' : ' knop-stil')} onClick={() => {setTitelReview(true);setZonderMp3(false);}}>Nieuwe titels beoordelen</button>
            </div>
            {!zonderMp3 && !titelReview && <div className="swipe-tabs" style={{marginTop:'.25rem'}}>
                <label style={{width:'100%'}}>Muziekcategorie
                    <select className="invoer" value={categorie} onChange={e=>setCategorie(e.target.value)}>
                        {categorieen.map(([waarde,naam])=><option value={waarde} key={waarde}>{naam}</option>)}
                    </select>
                </label>
            </div>}
            {gameSwipe ? <section className="kaart vt-titel-review">
                <h2>Videogames · Muziek-Swipe</h2>
                <p className="dim">Luister naar de originele gamemuziek. Keur alleen correcte muziek en herkenbare games goed.</p>
                {gameFout && <p className="waarschuwing">{gameFout}</p>}
                {games[0] ? <div className="vt-review-row">
                    <div className="swipe-bek">🎮</div>
                    <div><strong>{games[0].naam}</strong>
                        <p className="dim">{games[0].jaar||'—'} · {(games[0].platformen||[]).join(', ')}</p>
                        {gameAudio && <audio controls src={gameAudio} style={{width:'100%',maxWidth:340}} />}
                        {!gameAudio && <p className="dim">Muziek zoeken…</p>}
                        <div className="knoprij">
                            <button className="knop" onClick={()=>beoordeelGame('goedgekeurd')}>Goedkeuren</button>
                            <button className="knop knop-stil" onClick={()=>beoordeelGame('uitgesloten')}>Afwijzen</button>
                        </div>
                    </div>
                </div> : <p>Geen videogames om te swipen.</p>}
            </section> : zonderMp3 ? <section className="kaart vt-titel-review">
                <h2>Films en series zonder MP3</h2>
                <select className="invoer" value={categorie} onChange={e=>setCategorie(e.target.value)}>
                    <option value="film">Films</option><option value="serie">Series</option>
                </select>
                <p className="dim">{mp3Totaal} titels zonder lokale MP3 · eerste 200 zichtbaar. Handmatige aanvragen staan bovenaan en worden automatisch gezocht.</p>
                {mp3Fout && <p className="waarschuwing">{mp3Fout}</p>}
                {mp3Kaarten.map(t=><div className="vt-review-row" key={t.id}>
                    {t.poster_pad && <img src={'https://image.tmdb.org/t/p/w185'+t.poster_pad} loading="lazy" alt="" />}
                    <div><strong>{t.naam}</strong><p className="dim">{t.type} · {t.jaar||'—'} · {t.zoek_status||'niet gezocht'}{t.swipe_prioriteit?' · voorrang':''}</p>
                        <button className="knop knop-stil" onClick={()=>prioriteit(t,'prioriteit')}>Met voorrang MP3 zoeken</button>
                    </div>
                </div>)}
            </section> : titelReview ? (
                <section className="kaart vt-titel-review">
                    <h2>Nieuwe films en series</h2>
                    <p className="dim">Deze titels komen uit TMDB, los van de muziek-swipes. Goedkeuren voegt de titel toe aan de goedgekeurde catalogus.</p>
                    <p className="dim">{titelKaarten.length} wachten op beoordeling</p>
                    {titelFout && <p className="waarschuwing">{titelFout}</p>}
                    {titelKaarten.map(t => (
                        <div className="vt-review-row" key={t.id}>
                            {t.poster_pad && <img src={'https://image.tmdb.org/t/p/w185' + t.poster_pad} alt="" loading="lazy" />}
                            <div><strong>{t.naam}</strong><p className="dim">{t.type} · {t.jaar || 'jaar onbekend'}</p>
                                <div className="knoprij">
                                    <button className="knop" disabled={titelBezig === t.id} onClick={() => keurTitel(t,'goedgekeurd')}>Goedkeuren</button>
                                    <button className="knop knop-stil" disabled={titelBezig === t.id} onClick={() => keurTitel(t,'uitgesloten')}>Afwijzen</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>
            ) : <>
            {/* Fase-keuze */}
            <div className="swipe-tabs">
                <button className={'knop' + (fase === 'blind' ? '' : ' knop-stil')} onClick={() => setFase('blind')}>
                    1. Blind
                </button>
                <button className={'knop' + (fase === 'naam' ? '' : ' knop-stil')} onClick={() => setFase('naam')}>
                    2. Met naam
                </button>
            </div>

            <p className="dim swipe-uitleg" style={{ marginTop: 0 }}>
                {fase === 'blind'
                    ? 'Je hoort het nummer zonder titel. Herken je het?'
                    : 'Nu mét de titel erbij. Klopt dit nummer bij de titel?'}
            </p>

            {laadt && <p className="dim">Laden…</p>}

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
                                <div className="swipe-bek">{huidige.soort === 'kerst' ? '🎄' : huidige.soort === 'muziek' ? '🎵' : (huidige.type === 'serie' ? '📺' : '🎬')}</div>
                                {huidige.soort !== 'film_serie' ? (
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
                            {!audioUrl && !audioFout && <p className="dim">Luistervoorbeeld laden…</p>}
                            {audioFout && <p className="waarschuwing">{audioFout} Gebruik de oranje knop om dit onbruikbare fragment over te slaan.</p>}
                            {audioUrl && <audio key={audioUrl} ref={speler} controls autoPlay preload="auto" src={audioUrl}
                                style={{ width: '100%' }} onCanPlay={() => { setMagAfspelen(true); speler.current?.play().catch(() => {}); }}
                                onError={() => { setMagAfspelen(false); setAudioFout('MP3 kon niet worden afgespeeld.'); }} />}
                        </div>
                    </div>

                    {/* Knoppen verschillen per fase. */}
                    {fase === 'blind' ? (
                        <div className="swipe-knoppen">
                            <button className="swipe-knop fout" disabled={!magAfspelen || !!audioFout} onClick={() => swipe('niet')} aria-label="Ken ik niet">✕</button>
                            <button className="swipe-knop goed" disabled={!magAfspelen || !!audioFout} onClick={() => swipe('herkend')} aria-label="Ken ik">✓</button>
                            <button className="swipe-knop" style={{ background: "#e58a19", color: "#111" }} disabled={false} onClick={() => swipe('verkeerde_mp3')} aria-label="Verkeerde MP3" title="Verkeerde MP3">!</button>
                        </div>
                    ) : (
                        <div className="swipe-knoppen">
                            <button className="swipe-knop fout" disabled={!magAfspelen || !!audioFout} onClick={() => swipe('fout')} aria-label="Fout">✕</button>
                            <button className="swipe-knop weet" disabled={!magAfspelen || !!audioFout} onClick={() => swipe('onbekend')} aria-label="Onbekend">?</button>
                            <button className="swipe-knop goed" disabled={!magAfspelen || !!audioFout} onClick={() => swipe('goed')} aria-label="Goed">✓</button>
                            <button className="swipe-knop" style={{ background: "#e58a19", color: "#111" }} disabled={false} onClick={() => swipe('verkeerde_mp3')} aria-label="Verkeerde MP3" title="Verkeerde MP3">!</button>
                        </div>
                    )}
                    <p className="dim swipe-uitleg">
                        {fase === 'blind'
                            ? '✓ = herken ik. ✕ = herken ik niet (met naam). Oranje ! = verkeerde MP3.'
                            : '✓ = klopt. ✕ = fout nummer. ? = onbekend. Oranje ! = verkeerde MP3.'}
                    </p>
                </>
            )}
            </>}
        </main>
    );
}
