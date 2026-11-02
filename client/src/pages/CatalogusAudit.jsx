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
  useEffect(()=>{laad();},[]);
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
    <p className="dim">Rangschikking is voorlopig gebaseerd op bestaande populariteitsgegevens. Nederlandse tv-uitzendingen en bioscoopreleases vereisen apart bewijs. Geen titel of MP3 wordt automatisch veranderd of verwijderd.</p>
    <div className="rij wrap" style={{gap:8,flexWrap:'wrap'}}>
      <input className="invoer" placeholder="Zoek titel…" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select className="invoer" value={type} onChange={e=>setType(e.target.value)}><option value="alle">Films en series</option><option value="film">Films</option><option value="serie">Series</option></select>
      <select className="invoer" value={niveau} onChange={e=>setNiveau(e.target.value)}><option value="alle">Alle bekendheidsniveaus</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <select className="invoer" value={nl} onChange={e=>setNl(e.target.value)}><option value="alle">Alle NL-controles</option><option value="bevestigd">NL bevestigd</option><option value="onbevestigd">NL onbevestigd</option><option value="afgewezen">NL afgewezen</option></select>
      <label><input type="checkbox" checked={problemen} onChange={e=>setProblemen(e.target.checked)}/> Alleen problemen</label>
      <button className="knop knop-stil" onClick={laad} disabled={loading}>Vernieuwen</button>
    </div>
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
