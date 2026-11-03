import React,{useEffect,useState} from 'react';
import './catalogus-workspace.css';

export default function BeheerLogs(){
  const [filters,setFilters]=useState({niveau:'',zoek:'',actor:'',vanaf:''});
  const [actief,setActief]=useState({niveau:'',zoek:'',actor:'',vanaf:''});
  const [pagina,setPagina]=useState(1);
  const [data,setData]=useState({resultaten:[],totaal:0,perPagina:50});
  const [fout,setFout]=useState('');
  const [bezig,setBezig]=useState(false);
  async function laad(){
    setBezig(true);
    try{
      const qs=new URLSearchParams({...actief,pagina:String(pagina)});
      const r=await fetch('/api/admin/beheer-logs?'+qs.toString(),{credentials:'include'});
      const d=await r.json();
      if(!r.ok)throw Error(d.fout||'Loggegevens ontbreken');
      setData(d);setFout('');
    }catch(e){setFout(e.message)}
    finally{setBezig(false)}
  }
  useEffect(()=>{laad()},[actief,pagina]);
  function set(k,v){setFilters(f=>({...f,[k]:v}))}
  return <section className="kaart cw">
    <div className="cw-head"><div><h2>Logs</h2><p className="dim">Beheeracties en serverfouten, zonder gevoelige inhoud.</p></div>
      <button type="button" className="knop knop-stil" onClick={laad} disabled={bezig}>Vernieuwen</button>
    </div>
    <form className="cw-filters" onSubmit={e=>{e.preventDefault();setPagina(1);setActief({...filters})}}>
      <label>Niveau<select className="invoer" value={filters.niveau} onChange={e=>set('niveau',e.target.value)}>
        <option value="">Alles</option><option value="ERROR">Error</option><option value="WARNING">Warning</option><option value="INFO">Info</option>
      </select></label>
      <label>Actie<input className="invoer" value={filters.zoek} onChange={e=>set('zoek',e.target.value)} placeholder="Route of handeling"/></label>
      <label>Actor<select className="invoer" value={filters.actor} onChange={e=>set('actor',e.target.value)}>
        <option value="">Iedereen</option><option value="beheersessie">Beheer</option><option value="onbekend">Onbekend</option>
      </select></label>
      <label>Vanaf<input type="date" className="invoer" value={filters.vanaf} onChange={e=>set('vanaf',e.target.value)}/></label>
      <div className="cw-actions"><button className="knop" type="submit">Filter</button></div>
    </form>
    {fout&&<p className="waarschuwing">{fout}</p>}
    <strong>{data.totaal} gebeurtenissen</strong>
    <div className="cw-list">
      {data.resultaten.map(x=><details key={x.id} className="cw-logline">
        <summary><strong>{x.niveau}</strong> <span>{new Date(x.datum).toLocaleString('nl-NL')}</span> <span>{x.actie}</span> <span>HTTP {x.status}</span></summary>
        <p className="dim">Actor: {x.actor} · Duur: {x.duur_ms} ms · Bron: {x.bron}</p>
      </details>)}
      {!data.resultaten.length&&<p className="dim" style={{padding:12}}>Geen gebeurtenissen gevonden.</p>}
    </div>
    <div className="cw-pagination"><button className="knop knop-stil" type="button" onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={pagina<=1}>Vorige</button><span>{pagina} / {Math.max(1,Math.ceil(data.totaal/50))}</span><button className="knop knop-stil" type="button" disabled={pagina>=Math.ceil(data.totaal/50)} onClick={()=>setPagina(p=>p+1)}>Volgende</button></div>
    <p className="dim">Let op: uitvoer van Docker-containers en achtergrondjobs wordt nog niet volledig in dit overzicht bewaard.</p>
  </section>;
}
