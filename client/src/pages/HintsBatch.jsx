import React,{useEffect,useState} from 'react';
import './catalogus-workspace.css';
export default function HintsBatch(){
 const [limiet,setLimiet]=useState(250);
 const [status,setStatus]=useState(null);
 const [fout,setFout]=useState('');
 const [bezig,setBezig]=useState(false);
 async function request(url,opt){
  const r=await fetch(url,{credentials:'include',...opt});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.fout||'AI-verzoek mislukt');
  return j;
 }
 async function refresh(){try{setStatus(await request('/api/admin/ai-vragen/status'));setFout('')}catch(e){setFout(e.message)}}
 useEffect(()=>{
  refresh();const timer=setInterval(refresh,5000);return()=>clearInterval(timer);
 },[]);
 async function start(){
  setBezig(true);
  try{await request('/api/admin/ai-vragen/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limiet})});await refresh()}
  catch(e){setFout(e.message)}finally{setBezig(false)}
 }
 return <section className="kaart cw">
  <div className="cw-head"><h2>Hints & Bonusvragen</h2><span className="cw-info" title="Alleen ontbrekende of afgekeurde AI-vragen worden aangevuld. Meer titels per batch betekent niet automatisch minder tokens per titel." aria-label="Uitleg">i</span></div>
  {fout&&<p role="alert" className="waarschuwing">{fout}</p>}
  {status&&<div className="cw-stats">
   <span>Hints: {status.database?.hints_gegenereerd||0}/{status.database?.titels||0}</span>
   <span>Vragen: {status.database?.vragen_gegenereerd||0}/{status.database?.titels||0}</span>
   <span>Voortgang: {status.verwerkt||0}/{status.totaal||0}</span>
   <span>Fouten: {status.mislukt||0}</span>
  </div>}
  <div className="cw-head" style={{alignItems:'end',flexWrap:'wrap'}}>
   <label>Maximaal titels per batch<input className="invoer" type="number" min="1" max="500" step="1" value={limiet} onChange={e=>setLimiet(Math.min(500,Math.max(1,Number(e.target.value)||1)))} /></label>
   <button className="knop" type="button" disabled={bezig||status?.bezig} onClick={start}>{status?.bezig?'AI verwerkt…':'Ontbrekende hints en vragen ophalen'}</button>
   <button className="knop knop-stil" type="button" onClick={refresh}>Vernieuwen</button>
  </div>
  {!!status?.fouten?.length&&<details><summary>Laatste fouten ({status.fouten.length})</summary>
   <ul>{status.fouten.map((x,i)=><li key={i}>Titel {x.id}: {x.fout}</li>)}</ul>
  </details>}
 </section>;
}
