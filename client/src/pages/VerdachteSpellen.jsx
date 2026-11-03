import React,{useEffect,useState} from 'react';
import './catalogus-workspace.css';
export default function VerdachteSpellen(){
 const [data,setData]=useState(null);
 const [fout,setFout]=useState('');
 async function laad(){
  try{
   const r=await fetch('/api/admin/verdachte-spellen',{credentials:'include'});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.fout||'Controle mislukt');
   setData(d);setFout('');
  }catch(e){setFout(e.message)}
 }
 useEffect(()=>{laad()},[]);
 return <section className="kaart cw">
  <div className="cw-head"><div><h2>Opvallende spelresultaten</h2><p className="dim">Signalen uit gespeelde rondes, zonder automatische sancties.</p></div>
   <button className="knop knop-stil" onClick={laad}>Vernieuwen</button></div>
  {fout&&<p role="alert" className="waarschuwing">{fout}</p>}
  <small className="dim">{data?.toelichting}</small>
  <div className="cw-list">
   {data?.resultaten?.map(t=><div className="cw-line" key={t.speler_id}>
    <span><strong>{t.speler} · lobby {t.lobbycode}</strong>
     <small>{t.goed}/{t.antwoorden} juist · gemiddeld {((t.gemiddeld_ms||0)/1000).toFixed(2)} sec · snelste {((t.snelste_ms||0)/1000).toFixed(2)} sec</small>
    </span></div>)}
   {data&&!data.resultaten?.length&&<p className="dim" style={{padding:12}}>Geen opvallende patronen volgens deze eenvoudige controle.</p>}
  </div>
 </section>;
}
