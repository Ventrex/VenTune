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
    const [correctieOpen,setCorrectieOpen]=useState(false);
    const [eigenLink,setEigenLink]=useState('');
    const [zonderMp3, setZonderMp3] = useState(false);
    const [mp3Queue,setMp3Queue]=useState(null);
    const [mp3Kaarten,setMp3Kaarten]=useState([]);
    const [mp3Totaal,setMp3Totaal]=useState(0);
    const [mp3Fout,setMp3Fout]=useState('');
    const [titelKaarten, setTitelKaarten] = useState([]);
    const [titelFout, setTitelFout] = useState('');
    const [titelBezig, setTitelBezig] = useState(null);
    const [fase, setFase] = useState('blind');       // blind | naam
    const [categorie, setCategorie] = useState('film');
    const categorieen = [['film', 'Films'], ['serie', 'Series'], ['games', 'Videogames'], ['disney', 'Disney'], ['kerst', 'Kerst'], ['rock', 'Rock'], ['80s', '80s'], ['90s', '90s'], ['20s', '20s'], ['kinder', 'Kinder'], ['100nl', '100% NL']];
    const [kaarten, setKaarten] = useState([]);
    const [index, setIndex] = useState(0);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioFout, setAudioFout] = useState('');
    const [laadt, setLaadt] = useState(true);
    const [lijstFout,setLijstFout]=useState('');
    const [sleep, setSleep] = useState({ dx: 0, actief: false });
    const start = useRef(null);
    const speler = useRef(null);
    const [magAfspelen, setMagAfspelen] = useState(false);

    async function laad() {
        setLaadt(true);
        try {
            const lijst = await haal(`/api/admin/aanbevelingen?categorie=${categorie}&fase=${fase}`);
            setKaarten(lijst); setIndex(0); setLijstFout('');
        } catch(err) { setLijstFout(err.message); setKaarten([]); }
        setLaadt(false);
    }
    useEffect(() => {
        let actief=true;
        // Alleen opnieuw laden bij een daadwerkelijke categorie- of fasewissel.
        // Nooit de huidige afspeelkaart vervangen tijdens het luisteren.
        const start=async()=>{
            try {
                await haal('/api/admin/swipe/buffer',{method:'POST',...jsonBody({categorie,fase})});
                if(actief) await laad();
            }catch(err){if(actief)setLijstFout(err.message);}
        };
        start();
        return ()=>{actief=false;};
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[categorie,fase]);
    useEffect(() => {
        const update=()=>haal('/api/admin/swipe/mp3-wachtrij').then(setMp3Queue).catch(()=>{});
        update();
        const timer=setInterval(update,10000);
        return ()=>clearInterval(timer);
    }, []);

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
    const huidige = kaarten[index];
    const klaar = !laadt && !huidige;

    useEffect(() => {
        if (laadt || huidige || lijstFout || titelReview || zonderMp3) return undefined;
        const timer=setTimeout(()=>laad(),12000);
        return ()=>clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[laadt,huidige?.id,lijstFout,titelReview,zonderMp3,kaarten.length]);

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

    // Geen gelijktijdige achtergrondprefetch: meerdere yt-dlp downloads
    // overbelastten de backend en veroorzaakten 502 bij bestaande kaarten.

    async function swipe(keuze) {
        if (!huidige || (keuze !== 'verkeerde_mp3' && (!audioUrl || audioFout || !magAfspelen))) return;
        const id = huidige.id;
        setSleep({ dx: 0, actief: false });
        try {
            await haal('/api/admin/aanbevelingen/' + id + '/swipe', {
                method: 'POST', ...jsonBody({ keuze, fase }),
            });
            await haal('/api/admin/swipe/buffer',{method:'POST',...jsonBody({categorie,fase})});
            await laad();
        } catch (err) {
            // Een niet opgeslagen beoordeling mag de kaart niet laten verdwijnen.
            setAudioFout('Beoordeling niet opgeslagen: ' + err.message);
        }
    }

    async function bewaarCorrectie(reden){
      if(!huidige)return;
      try {
        await haal('/api/admin/aanbevelingen/'+huidige.id+'/correctie',{method:'POST',...jsonBody({reden})});
        setCorrectieOpen(false); await laad();
      } catch(e){setAudioFout(e.message);}
    }
    async function bewaarEigenLink(){
      if(!huidige||!eigenLink.trim())return;
      try{
        await haal('/api/admin/aanbevelingen/'+huidige.id+'/eigen-link',{method:'POST',...jsonBody({url:eigenLink})});
        setCorrectieOpen(false);setEigenLink('');await laad();
      }catch(e){setAudioFout(e.message);}
    }
    async function uitsluiten(){
        if(!huidige || !window.confirm('Dit nummer definitief afkeuren? Het komt niet meer terug in Swipe of in het spel.'))return;
        try{
            await haal('/api/admin/aanbevelingen/'+huidige.id+'/uitsluiten',{method:'POST'});
            await haal('/api/admin/swipe/buffer',{method:'POST',...jsonBody({categorie,fase})});
            await laad();
        }catch(e){setAudioFout('Afkeuren mislukt: '+e.message);}
    }
    function deelLink(){
        const url=window.location.origin+'/review?categorie='+encodeURIComponent(categorie)+'&fase=blind';
        if(navigator.share)navigator.share({title:'VenTune muziekswipe',url}).catch(()=>{});
        else if(navigator.clipboard)navigator.clipboard.writeText(url).then(()=>alert('Reviewlink gekopieerd: '+url));
        else window.prompt('Deel deze link:',url);
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
                <button className={'knop' + (!titelReview && !zonderMp3 ? '' : ' knop-stil')} onClick={() => {setTitelReview(false);setZonderMp3(false);}}>Muziek swipen</button>
                <button className={'knop' + (zonderMp3 ? '' : ' knop-stil')} onClick={() => {setTitelReview(false);setZonderMp3(true);}}>Zonder MP3 · hele database</button>
                <button className={'knop' + (titelReview ? '' : ' knop-stil')} onClick={() => {setTitelReview(true);setZonderMp3(false);}}>Nieuwe titels beoordelen</button>
            </div>
            {mp3Queue && <div className="kaart" style={{padding:'.65rem',margin:'.5rem 0'}}>
                <strong>MP3-downloadwachtrij</strong>
                {mp3Queue.rateLimitActief && <p style={{fontWeight:700,color:'var(--red-hot)'}}>YouTube-rate-limit actief · nog ongeveer {mp3Queue.wachtMinuten} minuten wachten</p>}
                <p className="dim" style={{margin:'.35rem 0'}}>Klaar voor Swipe: {mp3Queue.klaarVoorSwipe ?? 0} · Status: {mp3Queue.rateLimitActief?'gepauzeerd':mp3Queue.workerBezig?'downloaden':'wachten op volgende taak'} · {(mp3Queue.status||[]).map(s=>s.status+': '+s.aantal).join(' · ')||'wachtrij leeg'}</p>
                <p className="dim" style={{margin:'.25rem 0'}}>In Muziek swipen verschijnen alleen klaargezette MP3's. De queue probeert automatisch opnieuw zodra YouTube beschikbaar is.</p>
            </div>}
            {!zonderMp3 && !titelReview && <button className="knop knop-stil" type="button" onClick={deelLink}>Deel muziekswipe met vrienden (blind + met naam)</button>}
            {!zonderMp3 && !titelReview && <div className="swipe-tabs" style={{marginTop:'.25rem'}}>
                <label style={{width:'100%'}}>Muziekcategorie
                    <select className="invoer" value={categorie} onChange={e=>setCategorie(e.target.value)}>
                        {categorieen.map(([waarde,naam])=><option value={waarde} key={waarde}>{naam}</option>)}
                    </select>
                </label>
            </div>}
            {zonderMp3 ? <section className="kaart vt-titel-review">
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

            {lijstFout && <p className="waarschuwing">Swipe ophalen mislukt: {lijstFout} <button type="button" className="knop knop-stil" onClick={laad}>Opnieuw laden</button></p>}
            {laadt && <p className="dim">Laden…</p>}

            {klaar && !lijstFout && (
                <div className="kaart swipe-leeg">
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                        {fase === 'blind' ? 'Nog geen MP3 klaar om blind te swipen' : 'Nog geen MP3 klaar om met naam te beoordelen'}
                    </p>
                    <p className="dim">
                        {fase === 'blind'
                            ? 'VenTune vult de buffer van 10 nummers voor deze categorie. Je ziet nieuwe MP3’s vanzelf verschijnen.'
                            : 'Nieuwe luisterfragmenten verschijnen vanzelf zodra de download klaar is.'}
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
                                <p className="swipe-reden"><strong>YouTube-videotitel:</strong> {huidige.youtube_video_titel || 'Niet opgeslagen bij dit fragment (eerder gedownload)'}</p>
                                {huidige.voorbeeld_bron && <a className="knop knop-stil" href={'https://www.youtube.com/watch?v='+encodeURIComponent(huidige.voorbeeld_bron)} target="_blank" rel="noopener noreferrer">Bekijk de oorspronkelijke YouTube-video</a>}
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
                    <button className="knop knop-stil" type="button" onClick={()=>setCorrectieOpen(v=>!v)}>Wat is er mis? / eigen link</button>
                    {correctieOpen && <div className="kaart stapel" style={{marginTop:12}}><strong>Fout aangeven</strong><div className="rij" style={{flexWrap:"wrap",gap:8}}>{[[ "verkeerd_deel","Deel 2 i.p.v. deel 1"],["verkeerde_titel","Verkeerde film/serie"],["geen_intro","Niet de intro/theme"],["onherkenbaar","Niet herkenbaar"],["verkeerde_mp3","Verkeerde MP3"],["geen_geluid","Geen geluid"],["anders","Anders"]].map(([k,v])=><button type="button" className="knop knop-stil" key={k} onClick={()=>bewaarCorrectie(k)}>{v}</button>)}</div><label>Eigen YouTube-link<input className="invoer" value={eigenLink} onChange={e=>setEigenLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." /></label><button type="button" className="knop" onClick={bewaarEigenLink} disabled={!eigenLink.trim()}>Link downloaden en opnieuw beoordelen</button><p className="dim">Nieuwe MP3 gaat eerst naar blind swipen en daarna naar de beoordeling met naam.</p></div>}
                    <button className="knop knop-stil" type="button" onClick={uitsluiten}>Definitief afkeuren · nooit meer tonen of downloaden</button>
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
