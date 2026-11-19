import React,{useEffect,useState} from 'react';
import './catalogus-workspace.css';
const PAGINAS = [
  { naam: 'Beginpagina', url: '/', uitleg: 'De teksten op de startpagina. Je ziet wijzigingen nadat de pagina opnieuw is geladen.' },
  { naam: 'Navigatie', url: 'Alle pagina’s', uitleg: 'De knoppen in het gedeelde navigatiemenu. Dit is geen aparte URL.' },
];
const LIJST=[
 ['home.titel','Beginpagina','Koptekst','Kies je volgende quiz'],
 ['home.ondertitel','Beginpagina','Ondertitel','Start een nieuw spel, doe mee met vrienden of ga verder waar je was gebleven.'],
 ['home.nieuw_spel','Beginpagina','Nieuw spel','Nieuw spel'],
 ['home.meedoen','Beginpagina','Meedoen','Spel joinen'],
 ['home.doorgaan','Beginpagina','Verder spelen','Doorgaan vorig spel'],
 ['nav.spelen','Navigatie','Spelen','Spelen'],['nav.scores','Navigatie','Scores','Scores'],
 ['nav.controleren','Navigatie','Controleren','Controleren'],
 ['nav.beheer','Navigatie','Beheer','Beheer'],
 ['nav.profielen','Navigatie','Profielen','Profielen'],
 ['nav.inloggen','Navigatie','Inloggen','Inloggen'],
];
export default function SiteTeksten(){
 const [waarden,setWaarden]=useState({});
 const [fout,setFout]=useState('');
 const [melding,setMelding]=useState('');
 const [bezig,setBezig]=useState(false);
 useEffect(()=>{
  fetch('/api/admin/site-teksten',{credentials:'include'}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.fout||'Fout');setWaarden(j)})
   .catch(e=>setFout(e.message));
 },[]);
 async function bewaar(){
  setBezig(true);setFout('');setMelding('');
  try{
   const r=await fetch('/api/admin/site-teksten',{method:'PUT',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(waarden)});
   const d=await r.json();if(!r.ok)throw Error(d.fout||'Opslaan mislukt');
   setWaarden(d);setMelding('Teksten opgeslagen. Ze verschijnen bij het volgende laden van de pagina.');
  }catch(e){setFout(e.message)}finally{setBezig(false)}
 }
 return <section className="kaart cw">
  <div className="cw-head"><div><h2>Teksten</h2><p className="dim">Bewerk teksten zonder code te wijzigen. Lege velden gebruiken de standaardtekst.</p></div>
   <span className="cw-info" title="Voorlopig zijn de beginpagina en navigatie ondersteund. Meer schermen worden later toegevoegd." aria-label="Uitleg">i</span></div>
  {fout&&<p className="waarschuwing">{fout}</p>}{melding&&<p className="feedback neutraal">{melding}</p>}
  <p className="dim">Alles staat per pagina ingeklapt. Open alleen de pagina waarvan je tekst wilt veranderen.</p>
  {PAGINAS.map(pagina=><details key={pagina.naam} className="cw-copy-group vt-tekst-groep">
   <summary>
    <strong>{pagina.naam}</strong>
    <span className="dim">{pagina.url}</span>
   </summary>
   <p className="dim">{pagina.uitleg} {pagina.url.startsWith('/')&&<a href={pagina.url} target="_blank" rel="noreferrer">Bekijk pagina</a>}</p>
   <div className="cw-filters">
    {LIJST.filter(x=>x[1]===pagina.naam).map(([sleutel,,label,standaard])=><label key={sleutel}>
     {label}<input className="invoer" value={waarden[sleutel]??''}
       onChange={e=>setWaarden(v=>({...v,[sleutel]:e.target.value}))}
       placeholder={standaard} maxLength={180}/>
     <small>Standaard: {standaard}</small>
    </label>)}
   </div>
  </details>)}
  <button type="button" className="knop" onClick={bewaar} disabled={bezig}>{bezig?'Opslaan…':'Wijzigingen opslaan'}</button>
 </section>;
}
