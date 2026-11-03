import React,{useEffect,useState} from 'react';
import './catalogus-workspace.css';
export default function CatalogusAanbevelingen(){
 const [catalogi,setCatalogi]=useState([]);
 const [id,setId]=useState('');
 const [limiet,setLimiet]=useState(25);
 const [items,setItems]=useState([]);
 const [filter,setFilter]=useState('');
 const [bezig,setBezig]=useState(false);
 const [melding,setMelding]=useState('');
 const [fout,setFout]=useState('');
 async function api(url,opts){
  const r=await fetch(url,{credentials:'include',...opts});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.fout||'Verzoek mislukt');
  return j;
 }
 useEffect(()=>{
  api('/api/admin/catalogus-workspace/catalogi').then(d=>{
   setCatalogi(d);setId(old=>old||(d[0]?.id?String(d[0].id):''));
  }).catch(e=>setFout(e.message));
 },[]);
 async function vernieuw(){
  if(!id)return;try{
   const d=await api('/api/admin/aanbevelingen/catalogus/'+id+'/wachtrij');
   setItems(d.resultaten||[]);setFout('');
  }catch(e){setFout(e.message)}
 }
 useEffect(()=>{vernieuw();const t=setInterval(vernieuw,15000);return()=>clearInterval(t)},[id]);
 async function start(){
  if(!id)return;setBezig(true);setFout('');setMelding('');
  try{
   const d=await api('/api/admin/aanbevelingen/catalogus/'+id+'/start',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({limiet})
   });
   setMelding(d.toegevoegd+' kandidaten toegevoegd. '+d.toelichting);
   await vernieuw();
  }catch(e){setFout(e.message)}finally{setBezig(false)}
 }
 const zichtbaar=items.filter(t=>!filter||t.status===filter||t.download_status===filter);
 return <section className="kaart cw">
  <div className="cw-head"><div><h2>Aanbevelingen per catalogus</h2><p className="dim">Zoek ontbrekende muziek voor bestaande titels, zonder dubbele MP3-downloads.</p></div>
   <span className="cw-info" title="De achtergrondwachtrij respecteert wachttijden van YouTube. Nieuwe muziek wordt pas speelbaar na geslaagde kwaliteitscontrole." aria-label="Meer uitleg">i</span>
  </div>
  <div className="cw-filters">
    <label>Catalogus<select className="invoer" value={id} onChange={e=>setId(e.target.value)}>
      <option value="">Kies een catalogus</option>{catalogi.map(c=><option key={c.id} value={c.id}>{c.naam} · {c.titels+c.games} titels</option>)}
    </select></label>
    <label>Max. kandidaten<input className="invoer" type="number" min="1" max="100" value={limiet} onChange={e=>setLimiet(Math.max(1,Math.min(100,Number(e.target.value)||1)))}/></label>
    <div className="cw-actions"><button className="knop" disabled={!id||bezig} type="button" onClick={start}>Ontbrekende muziek ophalen</button></div>
  </div>
  {fout&&<p className="waarschuwing">{fout}</p>}{melding&&<p className="feedback neutraal">{melding}</p>}
  <div className="cw-head" style={{alignItems:'center'}}>
   <strong>Wachtrij ({items.length} getoond)</strong>
   <div style={{display:'flex',gap:8,alignItems:'center'}}>
    <select className="invoer" style={{maxWidth:190}} value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter wachtrijstatus">
     <option value="">Alle statussen</option><option value="wachtend">Wachtend</option><option value="bezig">Bezig</option>
     <option value="klaar">Voorbeeld klaar</option><option value="goed">Goedgekeurd</option><option value="nieuw">Nieuw</option>
    </select>
    <button type="button" className="knop knop-stil" onClick={vernieuw}>Vernieuwen</button>
   </div>
  </div>
  <div className="cw-list cw-queue">{zichtbaar.map(t=><div className="cw-line" key={t.id}>
   <span><strong>{t.titel}</strong><small>{t.categorie} · {t.status} · download {t.download_status}{t.fout?' · '+t.fout:''}</small></span>
  </div>)}
  {!zichtbaar.length&&<p className="dim" style={{padding:12}}>Geen resultaten met deze filters.</p>}</div>
 </section>;
}
