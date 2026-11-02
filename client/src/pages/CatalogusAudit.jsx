import React, {useEffect, useMemo, useState} from 'react';

const labels={
  zeer_bekend:'Zeer bekend',bekend:'Bekend',matig_bekend:'Redelijk bekend',
  onbekend:'Onbekend',niet_nederlands:'Niet in Nederland'
};
async function verzoek(url,opties) {
  const response=await fetch(url,{credentials:'include',...opties});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.fout||'Verzoek mislukt');
  return data;
}
export default function CatalogusAudit(){
  const [data,setData]=useState([]);
  const [aiData,setAiData]=useState([]);
  const [aiTaak,setAiTaak]=useState(null);
  const [aiType,setAiType]=useState('alle');
  const [aiNiveau,setAiNiveau]=useState('alle');
  const [aiBeslissing,setAiBeslissing]=useState('alle');
  const [dubbelen,setDubbelen]=useState([]);
  const [games,setGames]=useState([]);
  const [toonGames,setToonGames]=useState(false);
  const [vergelijk,setVergelijk]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(null);
  const [error,setError]=useState('');
  const [type,setType]=useState('alle');
  const [niveau,setNiveau]=useState('alle');
  const [nl,setNl]=useState('alle');
  const [problemen,setProblemen]=useState(false);
  const [query,setQuery]=useState('');
  const [open,setOpen]=useState(null);
  const [gevonden,setGevonden]=useState({});
  const [bron,setBron]=useState({});
  const laad=async()=>{setLoading(true);try{setData(await verzoek('/api/admin/catalogus-audit'));setError('');}catch(e){setError(e.message);}finally{setLoading(false);}};
  const laadAI=async()=>{try{const d=await verzoek('/api/admin/catalogus-ai');setAiData(d.resultaten||[]);setAiTaak(d.taak);}catch(e){setError(e.message);}};
  useEffect(()=>{laad();laadAI();},[]);
  useEffect(()=>{if(!aiTaak?.bezig)return;const id=setInterval(laadAI,5000);return()=>clearInterval(id);},[aiTaak?.bezig]);
  const startAI=async()=>{try{await post('/api/admin/catalogus-ai/start',{type:aiType});await laadAI();}catch(e){setError(e.message);}};
  const beslissingAI=async(t,b)=>{try{await post('/api/admin/catalogus-ai/'+t.type+'/'+t.id+'/beslissing',{beslissing:b});await laadAI();}catch(e){setError(e.message);}};

  const haalGames=async()=>{try{setGames(await verzoek('/api/admin/games/kwaliteit'));setToonGames(true);}catch(e){setError(e.message);}};
  const beoordeelGame=async(g,gameIconisch,muziekIconisch)=>{try{await verzoek('/api/admin/games/'+g.id+'/iconisch',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_iconisch:gameIconisch,muziek_iconisch:muziekIconisch})});await haalGames();}catch(e){setError(e.message);}};
  const haalDubbelen=async()=>{try{setDubbelen(await verzoek('/api/admin/database/dubbelen'));setVergelijk(true);}catch(e){setError(e.message);}};
  const lijst=useMemo(()=>data.filter(t=>
    (type==='alle'||t.type===type)&&
    (niveau==='alle'||t.niveau===niveau)&&
    (nl==='alle'||t.nl_verificatie===nl)&&
    (!problemen||t.problemen.length>0)&&
    (!query||t.naam.toLowerCase().includes(query.toLowerCase()))
  ),[data,type,niveau,nl,problemen,query]);
  const actie=async(id,fn)=>{setBusy(id);setError('');try{await fn();await laad();}catch(e){setError(e.message);}finally{setBusy(null);}};
  const post=(url,body)=>verzoek(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const verwijder=t=>{if(!window.confirm(`"${t.naam}" definitief uit de collectie verwijderen? Ook gekoppelde lokale MP3-bestanden worden verwijderd. Dit is niet terug te draaien.`))return;
    actie(t.id,()=>verzoek('/api/admin/titels/'+t.id,{method:'DELETE'}));};
  return <section className="kaart stapel">
    <h2>Collectiecontrole · Nederlandse bekendheid</h2>
    <div className="kaart stapel">
      <h3>AI-onderzoek · Nederlandse bekendheid en iconische games</h3>
      <p className="dim">Laat AI per titel live op het web zoeken naar Nederlandse bioscoopvertoningen, tv-uitzendingen, Nederlandse streamingdiensten en iconische videogames of muziek. De gevonden bronnen en onzekerheden blijven zichtbaar. Weg is alleen een markering; er worden geen titels of MP3's automatisch verwijderd.</p>
      <div className="rij" style={{gap:8,flexWrap:'wrap'}}>
        <select className="invoer" value={aiType} onChange={e=>setAiType(e.target.value)}><option value="alle">Alle films, series en games</option><option value="film">Films</option><option value="serie">Series</option><option value="game">Videogames</option></select>
        <button className="knop" disabled={aiTaak?.bezig} onClick={startAI}>{aiTaak?.bezig?'AI onderzoekt…':'Start AI-onderzoek'}</button>
        <button className="knop knop-stil" onClick={laadAI}>Resultaten vernieuwen</button>
      </div>
      {aiTaak&&<p className="dim">Voortgang: {aiTaak.verwerkt}/{aiTaak.totaal} · Onderzocht: {aiTaak.geslaagd} · Fouten: {aiTaak.fouten}{aiTaak.laatsteFout?' · '+aiTaak.laatsteFout:''}</p>}
      <div className="rij" style={{gap:8,flexWrap:'wrap'}}>
        <select className="invoer" value={aiNiveau} onChange={e=>setAiNiveau(e.target.value)}><option value="alle">Alle niveaus</option><option value="iconisch">Iconisch</option><option value="zeer_bekend">Zeer bekend</option><option value="bekend">Bekend</option><option value="redelijk_bekend">Redelijk bekend</option><option value="onbekend">Onbekend</option></select>
        <select className="invoer" value={aiBeslissing} onChange={e=>setAiBeslissing(e.target.value)}><option value="alle">Alle beslissingen</option><option value="open">Nog beoordelen</option><option value="behouden">Behouden</option><option value="twijfel">Twijfel</option><option value="weg">Weg</option></select>
      </div>
      {aiData.filter(t=>(aiType==='alle'||t.type===aiType)&&(aiNiveau==='alle'||t.niveau===aiNiveau)&&(aiBeslissing==='alle'||t.beslissing===aiBeslissing)).map(t=><article key={t.type+'-'+t.id} className="kaart stapel" style={{padding:12}}>
        <strong>{t.naam} ({t.jaar||'?'}) · {t.type} · {({'iconisch':'Iconisch','zeer_bekend':'Zeer bekend','bekend':'Bekend','redelijk_bekend':'Redelijk bekend','onbekend':'Onbekend'})[t.niveau]}</strong>
        <p className="dim">Nederlandse relevantie: {t.nl_relevant?'aannemelijk':'niet bevestigd'} · Zekerheid: {t.zekerheid} · Jouw keuze: {t.beslissing}</p>
        <p>{t.reden}</p>
        <div className="stapel">{(t.bronnen||[]).map((b,i)=><a key={i} href={b.url} target="_blank" rel="noopener noreferrer">{b.omschrijving||b.url}</a>)}</div>
        <div className="rij" style={{gap:8,flexWrap:'wrap'}}>{[['behouden','Behouden'],['twijfel','Twijfel'],['weg','Weg']].map(([k,v])=><button key={k} className={t.beslissing===k?'knop':'knop knop-stil'} onClick={()=>beslissingAI(t,k)}>{v}</button>)}</div>
      </article>)}
    </div>
    <p className="dim">Rangschikking is voorlopig gebaseerd op bestaande populariteitsgegevens. Nederlandse tv-uitzendingen en bioscoopreleases vereisen apart bewijs. Geen titel of MP3 wordt automatisch veranderd of verwijderd.</p>
    <div className="rij wrap" style={{gap:8,flexWrap:'wrap'}}>
      <input className="invoer" placeholder="Zoek titel…" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select className="invoer" value={type} onChange={e=>setType(e.target.value)}><option value="alle">Films en series</option><option value="film">Films</option><option value="serie">Series</option></select>
      <select className="invoer" value={niveau} onChange={e=>setNiveau(e.target.value)}><option value="alle">Alle bekendheidsniveaus</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <select className="invoer" value={nl} onChange={e=>setNl(e.target.value)}><option value="alle">Alle NL-controles</option><option value="bevestigd">NL bevestigd</option><option value="onbevestigd">NL onbevestigd</option><option value="afgewezen">NL afgewezen</option></select>
      <label><input type="checkbox" checked={problemen} onChange={e=>setProblemen(e.target.checked)}/> Alleen problemen</label>
      <button className="knop knop-stil" onClick={laad} disabled={loading}>Vernieuwen</button>
      <button className="knop knop-stil" onClick={haalDubbelen}>Vergelijk dubbele titels</button>
      <button className="knop knop-stil" onClick={haalGames}>Controleer iconische games</button>
    </div>
    {toonGames&&<div className="kaart stapel"><div className="rij" style={{justifyContent:'space-between'}}><strong>Videogames · iconisch spel of iconische muziek</strong><button className="knop knop-stil" onClick={()=>setToonGames(false)}>Sluiten</button></div><p className="dim">Een game voldoet als het spel zelf of de bijbehorende originele herkenningsmuziek iconisch is. Handmatig beoordelen; niets wordt automatisch verwijderd. {games.filter(g=>g.kwaliteitsstatus==='controle_nodig').length} nog te controleren.</p>{games.map(g=><div className="kaart" key={g.id}><strong>{g.naam}</strong> <span className="dim">({g.jaar||'—'}) · {g.kwaliteitsstatus.replaceAll('_',' ')}</span><div className="rij" style={{gap:8,flexWrap:'wrap'}}><button className="knop knop-stil" onClick={()=>beoordeelGame(g,true,g.muziek_iconisch)}>Spel iconisch</button><button className="knop knop-stil" onClick={()=>beoordeelGame(g,g.game_iconisch,true)}>Muziek iconisch</button><button className="knop knop-stil" onClick={()=>beoordeelGame(g,false,false)}>Geen van beide</button><button className="knop knop-stil" onClick={()=>beoordeelGame(g,null,null)}>Onzeker</button></div></div>)}</div>}
    {vergelijk&&<div className="kaart stapel"><div className="rij" style={{justifyContent:'space-between'}}><strong>Mogelijke dubbele films en series ({dubbelen.length})</strong><button className="knop knop-stil" onClick={()=>setVergelijk(false)}>Sluiten</button></div><p className="dim">Vergelijk beide records en TMDB-ID's. Dezelfde naam kan een remake of ander jaar zijn. Er wordt niets automatisch samengevoegd of verwijderd.</p>{dubbelen.map(d=><div key={d.id_a+'-'+d.id_b} className="kaart"><div className="rij" style={{gap:12,flexWrap:'wrap',justifyContent:'space-between'}}><div><strong>{d.naam_a}</strong> ({d.jaar_a||'—'})<p className="dim">{d.type} · TMDB: {d.tmdb_a||'onbekend'} · ID {d.id_a}</p><button className="knop knop-stil" onClick={()=>{setQuery(d.naam_a);setOpen(d.id_a);setVergelijk(false);}}>Bekijk A</button></div><span>vs.</span><div><strong>{d.naam_b}</strong> ({d.jaar_b||'—'})<p className="dim">TMDB: {d.tmdb_b||'onbekend'} · ID {d.id_b}</p><button className="knop knop-stil" onClick={()=>{setQuery(d.naam_b);setOpen(d.id_b);setVergelijk(false);}}>Bekijk B</button></div></div><p className="dim">Signaal: {d.reden==='zelfde_tmdb'?'Dezelfde TMDB-identificatie':'Gelijke titel; handmatig vergelijken'}</p></div>)}</div>}
    <p className="dim">{loading?'Collectie laden…':`${lijst.length} van ${data.length} titels zichtbaar`}</p>
    {error&&<p className="waarschuwing" role="alert">{error}</p>}
    <div className="stapel" style={{gap:10}}>
      {lijst.map(t=><article key={t.id} className="kaart" style={{padding:14}}>
        <div className="rij" style={{justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
          <div><strong>{t.naam}</strong> <span className="dim">({t.jaar||'?'}) · {t.type}</span>
            <p className="dim">{labels[t.niveau]} (indicatie) · NL: {t.nl_verificatie||'onbevestigd'} · {t.mp3_aantal} MP3 · {t.tracks_aantal} tracks</p>
            {t.problemen.length>0&&<p className="waarschuwing">{t.problemen.join(' · ')}</p>}
            {t.nl_bewijs&&<p className="dim">{t.nl_bewijs}</p>}
          </div>
          <button className="knop knop-stil" onClick={()=>setOpen(open===t.id?null:t.id)}>{open===t.id?'Sluiten':'Beoordelen'}</button>
        </div>
        {open===t.id&&<div className="stapel" style={{marginTop:12,gap:10}}>
          <p className="dim">TMDB is geen bewijs van Nederlandse televisie-uitzending. Voor films controleren we alleen expliciete Nederlandse bioscooprelease-data.</p>
          <button className="knop knop-stil" disabled={busy!==null} onClick={()=>actie(t.id,()=>post(`/api/admin/catalogus-audit/${t.id}/controleer-nl`))}>Controleer Nederlandse release via TMDB</button>
          <input className="invoer" placeholder="Bron voor Nederlandse tv-uitzending of bioscoop (URL, zender, datum)" value={bron[t.id]??t.nl_bewijs??''} onChange={e=>setBron({...bron,[t.id]:e.target.value})}/>
          <div className="rij" style={{gap:8,flexWrap:'wrap'}}>
            <button className="knop knop-stil" disabled={busy!==null} onClick={()=>actie(t.id,()=>post(`/api/admin/catalogus-audit/${t.id}/beoordeel`,{status:'bevestigd',bewijs:bron[t.id]??t.nl_bewijs}))}>NL bevestigd</button>
            <button className="knop knop-stil" disabled={busy!==null} onClick={()=>actie(t.id,()=>post(`/api/admin/catalogus-audit/${t.id}/beoordeel`,{status:'onbevestigd',bewijs:bron[t.id]??''}))}>Nog onzeker</button>
            <button className="knop knop-stil" disabled={busy!==null} onClick={()=>actie(t.id,()=>post(`/api/admin/catalogus-audit/${t.id}/beoordeel`,{status:'afgewezen',bewijs:bron[t.id]??''}))}>NL afgewezen</button>
          </div>
          <strong>Gekoppelde muziek</strong>
          {t.tracks.map(track=><p key={track.id} className="dim">{track.naam||'Geen titel'} · Video: {track.youtube_titel||'Niet vastgelegd'} · {track.status||'status onbekend'} {track.bron_url&&<a href={track.bron_url} target="_blank" rel="noopener noreferrer">Bron bekijken</a>}</p>)}
          <button className="knop knop-stil" disabled={busy!==null} onClick={async()=>{setBusy(t.id);try{const r=await verzoek(`/api/admin/catalogus-audit/${t.id}/muziek-zoek`);setGevonden({...gevonden,[t.id]:r});}catch(e){setError(e.message);}finally{setBusy(null);}}}>Zoek betere titelsong / intro</button>
          {gevonden[t.id]&&<div><p className="dim">Zoekopdracht: {gevonden[t.id].zoekterm}. Alleen suggesties, geen automatische vervanging.</p>{gevonden[t.id].kandidaten?.map((k,i)=><p key={i}>{k.titel} {k.controle?.past?'· titelmatch':'· twijfelachtige match'} {k.videoId&&<a href={`https://www.youtube.com/watch?v=${encodeURIComponent(k.videoId)}`} target="_blank" rel="noopener noreferrer">Luisteren</a>}</p>)}</div>}
          <div><button className="knop knop-stil" style={{color:'#ff7777'}} disabled={busy!==null} onClick={()=>verwijder(t)}>Titel definitief verwijderen</button></div>
        </div>}
      </article>)}
    </div>
  </section>;
}
