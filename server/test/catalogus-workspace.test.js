// Integratietest voor de cataloguswerkruimte met een echte CI-PostgreSQL.
// Alle testrecords worden achteraf verwijderd.
if(!process.env.TEST_DATABASE_URL){
  console.log('catalogus-workspace: overgeslagen (geen TEST_DATABASE_URL)');
  process.exit(0);
}
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const assert=require('node:assert/strict');
const express=require('express');
const {pool}=require('../db/pool');
const registreer=require('../routes/catalogus-workspace');
const suffix=String(Date.now());
const filmName='Test Film CW '+suffix;
const gameName='Test Game CW '+suffix;
const catalogName='Test Selectie CW '+suffix;
let filmId=null,gameId=null,catalogId=null,server=null;
async function main(){
  const app=express();app.use(express.json());registreer(app,(_req,_res,next)=>next(),pool);
  server=await new Promise((resolve)=>{const s=app.listen(0,()=>resolve(s))});
  const origin='http://127.0.0.1:'+server.address().port;
  async function get(path){
    const r=await fetch(origin+path);const d=await r.json();
    assert.equal(r.status,200,JSON.stringify(d));return d;
  }
  async function post(path,data,expected=201){
    const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d;
  }
  // Laat de additieve catalogustabel eerst aanmaken.
  await get('/api/admin/catalogus-workspace/titels?type=game&zoek=NietBestaandCW');
  const f=await pool.query(`INSERT INTO titels(naam,type,taal,jaar,studio,populariteit,bekendheidsniveau)
    VALUES($1,'film','en',2006,'StudioCW',90,'iconisch') RETURNING id`,[filmName]);filmId=f.rows[0].id;
  const g=await pool.query(`INSERT INTO game_catalogus(naam,jaar,platformen) VALUES($1,2006,ARRAY['PC']) RETURNING id`,[gameName]);gameId=g.rows[0].id;
  const q=await get('/api/admin/catalogus-workspace/titels?studio=StudioCW&type=film&bekendheid=iconisch&vanaf=2000&tot=2010&mp3=nee');
  assert(q.resultaten.some(x=>x.naam===filmName));
  assert(!q.resultaten.some(x=>x.type==='game'));
  const games=await get('/api/admin/catalogus-workspace/titels?type=game&zoek='+encodeURIComponent(gameName));
  assert(games.resultaten.some(x=>x.naam===gameName));
  const result=await post('/api/admin/catalogus-workspace/catalogi',{
    naam:catalogName,doelgroep:'alles',selectie:['titel-'+filmId,'game-'+gameId]});
  catalogId=result.id;assert.equal(result.toegevoegd,2);
  const details=await get('/api/admin/catalogus-workspace/catalogi/'+catalogId+'/items');
  assert.equal(details.resultaten.length,2);
  const listing=await get('/api/admin/catalogus-workspace/catalogi');
  assert(listing.some(x=>x.id===catalogId&&x.titels===1&&x.games===1));
  console.log('catalogus-workspace: filters en bulkcatalogus geslaagd');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(catalogId) await pool.query('DELETE FROM collecties WHERE id=$1',[catalogId]).catch(()=>{});
  if(gameId) await pool.query('DELETE FROM game_catalogus WHERE id=$1',[gameId]).catch(()=>{});
  if(filmId) await pool.query('DELETE FROM titels WHERE id=$1',[filmId]).catch(()=>{});
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
});
