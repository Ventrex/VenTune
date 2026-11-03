import React, {useEffect,useRef,useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import Brand from '../components/Brand.jsx';

function stemmerId(){
 try {
  let id=localStorage.getItem('ventune_stemmer');
  if(!id){id=Math.random().toString(36).slice(2)+Date.now();localStorage.setItem('ventune_stemmer',id);}
  return id;
 }catch{return 'anon-'+Math.random().toString(36).slice(2);}
}
async function api(url,options){
 const r=await fetch(url,options);
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.fout||'Serverfout '+r.status);
 return d;
}
export default function Review(){
 const [query]=useSearchParams();
 const categorieen=[['film','Films'],['serie','Series'],['muziek','Muziek'],['games','Videogames'],['rock','Rock'],['100nl','100% NL'],['kerst','Kerst'],['80s','80s'],['90s','90s'],['kinder','Kinder']];
 const init=query.get('categorie')||'film';
 const [categorie,setCategorie]=useState(categorieen.some(c=>c[0]===init)?init:'film');
 const [fase,setFase]=useState(query.get('fase')==='naam'?'naam':'blind');
 const stemmer=useRef(stemmerId());
 const [kaart,setKaart]=useState(null);
 const [laadt,setLaadt]=useState(true);
 const [fout,setFout]=useState('');
 const [aantal,setAantal]=useState(0);
 async function volgende(){
  setLaadt(true);setKaart(null);setFout('');
  try{
   const d=await api('/api/swipe-delen/volgende?'+new URLSearchParams({categorie,fase,stemmer:stemmer.current}));
   setKaart(d.klaar?null:d);
  }catch(e){setFout(e.message);}
  finally{setLaadt(false);}
 }
 useEffect(()=>{volgende();},[categorie,fase]);
 async function stem(keuze){
  if(!kaart)return;
  try{
   await api('/api/swipe-delen/'+kaart.id+'/stem',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({stemmer:stemmer.current,fase,keuze})});
   setAantal(n=>n+1);await volgende();
  }catch(e){setFout(e.message);}
 }
 return <main className="scherm admin-swipe">
  <div className="ai-kop"><Brand link={false}/></div>
  <h1>Help VenTune met muzieknummers beoordelen</h1>
  <div className="kaart" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',padding:12}}>
    <label htmlFor="review-categorie">Wat wil je controleren?</label>
    <select id="review-categorie" className="invoer" style={{maxWidth:280,minHeight:38}}
      value={categorie} onChange={e=>{setCategorie(e.target.value);setAantal(0);}}>
      {categorieen.map(([id,naam])=><option key={id} value={id}>{naam}</option>)}
    </select>
    <span className="dim">{aantal} beoordeeld · stemmen worden apart bewaard</span>
  </div>
  <div className="swipe-tabs">
   <button className={'knop'+(fase==='blind'?'':' knop-stil')} onClick={()=>setFase('blind')}>1. Blind</button>
   <button className={'knop'+(fase==='naam'?'':' knop-stil')} onClick={()=>setFase('naam')}>2. Met naam</button>
  </div>
  {fout&&<p className="waarschuwing">{fout}</p>}
  {laadt?<p>Luisterfragmenten laden…</p>:kaart?<div className="kaart swipe-leeg">
   <h2>{fase==='blind'?'Welk nummer is dit?':kaart.titel}</h2>
   {fase==='naam'&&<p className="dim">{kaart.tracknaam||''} {kaart.artiest||''}</p>}
   <audio key={kaart.id} controls preload="metadata" src={kaart.audioUrl} style={{width:'100%'}}/>
   <div className="swipe-knoppen">
    {fase==='blind'?<>
      <button className="knop" onClick={()=>stem('niet')}>Herken ik niet</button>
      <button className="knop" onClick={()=>stem('herkend')}>Herken ik</button>
     </>:<>
      <button className="knop" onClick={()=>stem('fout')}>Klopt niet</button>
      <button className="knop" onClick={()=>stem('onbekend')}>Weet ik niet</button>
      <button className="knop" onClick={()=>stem('goed')}>Klopt</button>
     </>}
   </div>
  </div>:<div className="kaart swipe-leeg">
    <h2>Er staan momenteel geen andere MP3's klaar.</h2>
    <p className="dim">Wanneer de beheerder nieuwe nummers voorbereidt, kun je verder stemmen.</p>
    {fase==='blind'&&<button className="knop" onClick={()=>setFase('naam')}>Verder met naam</button>}
    <Link className="knop knop-stil" to="/">VenTune</Link>
  </div>}
 </main>;
}
