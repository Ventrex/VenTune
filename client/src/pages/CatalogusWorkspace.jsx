import React,{useEffect,useMemo,useState} from 'react';
import './catalogus-workspace.css';

const BASIS='/api/admin/catalogus-workspace';
const LEEG={zoek:'',type:'alles',studio:'',artiest:'',vanaf:'',tot:'',bekendheid:'',mp3:'alle',minPopulariteit:''};
const DOELEN=[['beide','Films & Series'],['film','Films'],['serie','Series'],['muziek','Muziek'],['games','Videospellen'],['alles','Alle soorten']];
async function verzoek(pad,opts={}) {
  const r=await fetch(BASIS+pad,{credentials:'include',...opts});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.fout||'Verzoek mislukt');
  return d;
}
const json=(value)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
function Info({tekst}){return <span className="cw-info" title={tekst} aria-label={tekst} role="img" tabIndex={0}>i</span>}

export default function CatalogusWorkspace({view='titels',onLegacyEdit}){
  const [filters,setFilters]=useState(LEEG);
  const [actief,setActief]=useState(LEEG);
  const [pagina,setPagina]=useState(1);
  const [data,setData]=useState({resultaten:[],totaal:0,pagina:1,perPagina:40});
  const [catalogi,setCatalogi]=useState([]);
  const [selectie,setSelectie]=useState([]);
  const [alleGefilterde,setAlleGefilterde]=useState(false);
  const [naam,setNaam]=useState('');
  const [doelgroep,setDoelgroep]=useState('beide');
  const [beschrijving,setBeschrijving]=useState('');
  const [foto,setFoto]=useState(null);
  const [bestaand,setBestaand]=useState('');
  const [openCatalogus,setOpenCatalogus]=useState(null);
  const [items,setItems]=useState([]);
  const [editNaam,setEditNaam]=useState('');
  const [editDoel,setEditDoel]=useState('beide');
  const [bezig,setBezig]=useState(false);
  const [laden,setLaden]=useState(false);
  const [melding,setMelding]=useState('');
  const [fout,setFout]=useState('');

  const aantalGeselecteerd=alleGefilterde?data.totaal:selectie.length;
  const query=useMemo(()=>new URLSearchParams({...actief,pagina:String(pagina),perPagina:'40'}).toString(),[actief,pagina]);
  async function haalCatalogi(){
    try{setCatalogi(await verzoek('/catalogi'))}catch(e){setFout(e.message)}
  }
  async function haalTitels(){
    setLaden(true);
    try{const d=await verzoek('/titels?'+query);setData(d);setFout('')}
    catch(e){setFout(e.message)}
    finally{setLaden(false)}
  }
  useEffect(()=>{haalCatalogi()},[]);
  useEffect(()=>{if(view==='titels')haalTitels()},[query,view]);
  function pasFilterAan(key,value){setFilters(f=>({...f,[key]:value}))}
  function pasToe(e){e.preventDefault();setSelectie([]);setAlleGefilterde(false);setPagina(1);setActief({...filters})}
  function maakLeeg(){setFilters(LEEG);setActief(LEEG);setPagina(1);setSelectie([]);setAlleGefilterde(false)}
  function selecteerPagina(){
    const zicht=data.resultaten.map(x=>x.sleutel);
    const allemaal=zicht.every(x=>selectie.includes(x));
    setAlleGefilterde(false);
    setSelectie(a=>allemaal?a.filter(x=>!zicht.includes(x)):[...new Set([...a,...zicht])]);
  }
  function kies(key){setAlleGefilterde(false);setSelectie(a=>a.includes(key)?a.filter(x=>x!==key):[...a,key])}
  function omschrijf(item){
    return [item.type==='game'?'Videospel':item.type,item.jaar,item.studio||item.artiest,
      item.heeft_mp3?'MP3':'Geen MP3',item.bekendheid].filter(Boolean).join(' · ')
  }
  function valideerSelectie(){if(!aantalGeselecteerd)throw Error('Selecteer eerst titels of alle filterresultaten.')}
  async function createCatalogus(e){
    e.preventDefault();
    setBezig(true);setFout('');setMelding('');
    try{
      valideerSelectie();
      const nieuw=await verzoek('/catalogi',{method:'POST',...json({naam,doelgroep,beschrijving,
        selectie,alleGefilterde,filters:actief})});
      if(foto){const fd=new FormData();fd.append('afbeelding',foto);
        await verzoek('/catalogi/'+nieuw.id+'/afbeelding',{method:'POST',body:fd});
      }
      setMelding('Catalogus '+nieuw.naam+' gemaakt · '+nieuw.toegevoegd+' titels toegevoegd.');
      setNaam('');setBeschrijving('');setFoto(null);setSelectie([]);setAlleGefilterde(false);
      await haalCatalogi();
    }catch(e){setFout(e.message)}finally{setBezig(false)}
  }
  async function voegBestaandToe(){
    setBezig(true);setFout('');setMelding('');
    try{
      valideerSelectie();if(!bestaand)throw Error('Kies eerst een bestaande catalogus.');
      const r=await verzoek('/catalogi/'+bestaand+'/items',{method:'POST',...json({
        selectie,alleGefilterde,filters:actief})});
      setMelding(r.toegevoegd+' titels toegevoegd aan de bestaande catalogus.');
      await haalCatalogi();
    }catch(e){setFout(e.message)}finally{setBezig(false)}
  }
  async function openCatalogusDetails(c){
    if(openCatalogus===c.id){setOpenCatalogus(null);return}
    setOpenCatalogus(c.id);setEditNaam(c.naam);setEditDoel(c.doelgroep);
    try{const d=await verzoek('/catalogi/'+c.id+'/items');setItems(d.resultaten||[])}
    catch(e){setFout(e.message)}
  }
  async function bewaarCatalogus(c){
    setBezig(true);setFout('');
    try{await verzoek('/catalogi/'+c.id,{method:'PATCH',...json({naam:editNaam,doelgroep:editDoel})});
      setMelding('Catalogus bijgewerkt.');await haalCatalogi();
    }catch(e){setFout(e.message)}finally{setBezig(false)}
  }
  async function uploadFoto(c,file){
    if(!file)return;
    setBezig(true);setFout('');
    try{const fd=new FormData();fd.append('afbeelding',file);
      await verzoek('/catalogi/'+c.id+'/afbeelding',{method:'POST',body:fd});
      setMelding('Afbeelding bijgewerkt.');await haalCatalogi();
    }catch(e){setFout(e.message)}finally{setBezig(false)}
  }
  return <section className="cw kaart">
    {view==='titels'?<>
      <div className="cw-head"><div><h2>Titels</h2><p className="dim">Alle films, series, muziek en videogames in één overzicht.</p></div>
        <Info tekst="Filters combineren. Selecteer alleen deze pagina of alle resultaten van de gekozen filters. Er wordt geen MP3 opnieuw gedownload."/>
      </div>
      <form className="cw-filters" onSubmit={pasToe}>
        <label>Zoek<input className="invoer" value={filters.zoek} onChange={e=>pasFilterAan('zoek',e.target.value)} placeholder="Titel of artiest" /></label>
        <label>Soort<select className="invoer" value={filters.type} onChange={e=>pasFilterAan('type',e.target.value)}>
          <option value="alles">Alles</option><option value="film-serie">Films & Series</option><option value="film">Films</option>
          <option value="serie">Series</option><option value="muziek">Muziek</option><option value="game">Videospellen</option></select></label>
        <label>Studio<input className="invoer" value={filters.studio} onChange={e=>pasFilterAan('studio',e.target.value)} placeholder="Disney, Pixar…" /></label>
        <label>Artiest<input className="invoer" value={filters.artiest} onChange={e=>pasFilterAan('artiest',e.target.value)} placeholder="Queen…" /></label>
        <label>Bekendheid<select className="invoer" value={filters.bekendheid} onChange={e=>pasFilterAan('bekendheid',e.target.value)}>
          <option value="">Alle niveaus</option><option value="iconisch">Iconisch</option><option value="zeer_bekend">Zeer bekend</option><option value="bekend">Bekend</option><option value="redelijk_bekend">Redelijk bekend</option><option value="onbekend">Onbekend</option>
          </select></label>
        <label>MP3<select className="invoer" value={filters.mp3} onChange={e=>pasFilterAan('mp3',e.target.value)}>
          <option value="alle">Alles</option><option value="ja">Met lokale MP3</option><option value="nee">Geen MP3</option></select></label>
        <label>Vanaf jaar<input className="invoer" inputMode="numeric" type="number" min="1900" max="2100" value={filters.vanaf} onChange={e=>pasFilterAan('vanaf',e.target.value)} placeholder="2010"/></label>
        <label>Tot jaar<input className="invoer" inputMode="numeric" type="number" min="1900" max="2100" value={filters.tot} onChange={e=>pasFilterAan('tot',e.target.value)} placeholder="2020"/></label>
        <label>Min. populariteit<input className="invoer" type="number" min="0" step="0.1" value={filters.minPopulariteit} onChange={e=>pasFilterAan('minPopulariteit',e.target.value)} placeholder="0"/></label>
        <div className="cw-actions"><button className="knop" type="submit">Filter toepassen</button><button className="knop knop-stil" type="button" onClick={maakLeeg}>Wissen</button></div>
      </form>
      {melding&&<p className="feedback neutraal" role="status">{melding}</p>}
      {fout&&<p className="waarschuwing" role="alert">{fout}</p>}
      <div className="cw-listhead">
        <strong>{laden?'Laden…':data.totaal.toLocaleString('nl-NL')+' resultaten'}</strong>
        <button type="button" className="knop knop-stil" onClick={selecteerPagina} disabled={!data.resultaten.length}>Selecteer pagina</button>
        <button type="button" className="knop knop-stil" onClick={()=>{setAlleGefilterde(true);setSelectie([])}} disabled={!data.totaal}>Selecteer alle {data.totaal} filterresultaten</button>
        {!!aantalGeselecteerd&&<span>{aantalGeselecteerd} geselecteerd <button type="button" className="cw-textbutton" onClick={()=>{setSelectie([]);setAlleGefilterde(false)}}>Wissen</button></span>}
      </div>
      <div className="cw-list">
        {data.resultaten.map(item=><label className="cw-line" key={item.sleutel}>
          <input type="checkbox" checked={alleGefilterde||selectie.includes(item.sleutel)} onChange={()=>kies(item.sleutel)}/>
          <span><strong>{item.naam}</strong><small>{omschrijf(item)}</small></span>
        </label>)}
      </div>
      <div className="cw-pagination"><button type="button" className="knop knop-stil" disabled={pagina<=1} onClick={()=>setPagina(p=>p-1)}>Vorige</button>
      <span>Pagina {pagina} / {Math.max(1,Math.ceil(data.totaal/40))}</span>
      <button type="button" className="knop knop-stil" disabled={pagina>=Math.ceil(data.totaal/40)} onClick={()=>setPagina(p=>p+1)}>Volgende</button></div>
      <div className="cw-builder kaart">
        <h3>Collectie aanmaken <Info tekst="Je geselecteerde titels blijven in de database en delen dezelfde MP3's. Een film kan in meerdere collecties zitten."/></h3>
        <form className="cw-create" onSubmit={createCatalogus}>
          <label>Naam<input className="invoer" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="James Bond, Queen, Iconische films…" required/></label>
          <label>Onderdeel<select className="invoer" value={doelgroep} onChange={e=>setDoelgroep(e.target.value)}>{DOELEN.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>Afbeelding <small>(optioneel, vierkant)</small><input className="invoer" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setFoto(e.target.files?.[0]||null)}/></label>
          <label>Omschrijving<input className="invoer" value={beschrijving} onChange={e=>setBeschrijving(e.target.value)} placeholder="Optioneel"/></label>
          <button type="submit" className="knop" disabled={bezig||!aantalGeselecteerd}>Collectie aanmaken ({aantalGeselecteerd})</button>
        </form>
        <div className="cw-add-existing">
          <select className="invoer" value={bestaand} onChange={e=>setBestaand(e.target.value)} aria-label="Bestaande collectie">
            <option value="">Voeg toe aan bestaande collectie…</option>{catalogi.map(c=><option key={c.id} value={c.id}>{c.naam}</option>)}
          </select>
          <button className="knop knop-stil" disabled={bezig||!bestaand||!aantalGeselecteerd} type="button" onClick={voegBestaandToe}>Toevoegen</button>
        </div>
        {onLegacyEdit&&<button className="knop knop-stil" type="button" onClick={onLegacyEdit}>Geavanceerd: titelgegevens bewerken</button>}
      </div>
    </>:<>
      <div className="cw-head"><div><h2>Catalogen</h2><p className="dim">Bestaande en zelfgemaakte collecties. Afbeeldingen zijn later vervangbaar.</p></div><Info tekst="Maak nieuwe collecties vanuit Titels met gecombineerde filters; hier kun je inhoud, naam en afbeelding beheren."/></div>
      {melding&&<p className="feedback neutraal">{melding}</p>}{fout&&<p className="waarschuwing">{fout}</p>}
      <div className="cw-catalogs">{catalogi.map(c=><article className="cw-catalog" key={c.id}>
        <button type="button" className="cw-catalog-title" onClick={()=>openCatalogusDetails(c)}>
          {c.afbeelding_url?<img src={c.afbeelding_url} alt="" />:<span className="cw-catalog-placeholder" aria-hidden="true">♫</span>}
          <span><strong>{c.naam}</strong><small>{c.titels} titels · {c.games} spellen · {c.doelgroep}</small></span>
        </button>
        {openCatalogus===c.id&&<div className="cw-catalog-edit">
          <label>Naam<input className="invoer" value={editNaam} onChange={e=>setEditNaam(e.target.value)} /></label>
          <label>Onderdeel<select className="invoer" value={editDoel} onChange={e=>setEditDoel(e.target.value)}>{DOELEN.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Afbeelding (vierkant, 800 × 800 aanbevolen)<input type="file" className="invoer" accept="image/png,image/jpeg,image/webp" onChange={e=>uploadFoto(c,e.target.files?.[0])}/></label>
          <button type="button" className="knop" disabled={bezig} onClick={()=>bewaarCatalogus(c)}>Opslaan</button>
          <details><summary>Inhoud ({items.length} getoond)</summary><ul>{items.map((item,i)=><li key={item.type+'-'+item.id+'-'+i}>{item.naam} ({item.jaar||'—'}) · {item.type}</li>)}</ul></details>
        </div>}
      </article>)}</div>
    </>}
  </section>;
}
