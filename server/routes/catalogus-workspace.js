// Nieuwe catalogus-werkruimte. Additief: bestaande titels, tracks en collecties blijven intact.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.MEDIA_DIR || '/media','uploads');
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
const DOELEN = ['film','serie','beide','muziek','games','alles'];
const TIJDELIJKE_GAME_TABEL = `CREATE TABLE IF NOT EXISTS game_catalogus
(id BIGSERIAL PRIMARY KEY, naam TEXT NOT NULL, jaar INTEGER,
platformen TEXT[] NOT NULL DEFAULT '{}', opmerking TEXT,
status TEXT NOT NULL DEFAULT 'nieuw',aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
UNIQUE(naam,jaar))`;
let ready;
async function init(pool) {
  if(!ready) ready = (async()=>{
    await pool.query(TIJDELIJKE_GAME_TABEL);
    await pool.query('ALTER TABLE game_catalogus ADD COLUMN IF NOT EXISTS game_iconisch BOOLEAN');
    await pool.query('ALTER TABLE game_catalogus ADD COLUMN IF NOT EXISTS muziek_iconisch BOOLEAN');
    await pool.query(`CREATE TABLE IF NOT EXISTS beheer_catalogus_info (
      collectie_id INTEGER PRIMARY KEY REFERENCES collecties(id) ON DELETE CASCADE,
      doelgroep TEXT NOT NULL DEFAULT 'beide',
      afbeelding_url TEXT,
      bijgewerkt_op TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS beheer_catalogus_games (
      collectie_id INTEGER NOT NULL REFERENCES collecties(id) ON DELETE CASCADE,
      game_id BIGINT NOT NULL REFERENCES game_catalogus(id) ON DELETE CASCADE,
      PRIMARY KEY(collectie_id,game_id)
    )`);
  })().catch(e=>{ready=null;throw e});
  return ready;
}
const BASIS = `
 WITH alle AS (
   SELECT ('titel-'||t.id)::text AS sleutel,t.id::bigint AS item_id,
     t.type::text AS type,t.naam,t.jaar,
     COALESCE(t.studio,'') AS studio,
     COALESCE((SELECT string_agg(DISTINCT NULLIF(BTRIM(x.artiest),''),', ')
       FROM tracks x WHERE x.titel_id=t.id),'') AS artiest,
     COALESCE(t.bekendheidsniveau,'onbekend') AS bekendheid,
     t.populariteit::float8 AS populariteit,t.stemmen::int AS stemmen,
     EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id=t.id
       AND x.bron='lokaal' AND x.werkt=true AND x.download_status='available') AS heeft_mp3
   FROM titels t
   UNION ALL
   SELECT ('game-'||g.id)::text,g.id::bigint,'game'::text,
     g.naam,g.jaar,''::text,''::text,
     CASE WHEN g.game_iconisch IS TRUE OR g.muziek_iconisch IS TRUE
       THEN 'iconisch' ELSE 'onbekend' END,
     NULL::float8,NULL::int,
     EXISTS (SELECT 1 FROM titels t JOIN tracks x ON x.titel_id=t.id
       WHERE lower(t.naam)=lower(g.naam) AND t.type::text='muziek'
       AND x.bron='lokaal' AND x.werkt AND x.download_status='available')
   FROM game_catalogus g
 )`;
function leesFilters(query={}) {
  const type = String(query.type||'alles');
  const bekendheid = String(query.bekendheid||'');
  const mp3 = String(query.mp3||'alle');
  const vanaf = query.vanaf==='' || query.vanaf==null ? null : Number(query.vanaf);
  const tot = query.tot==='' || query.tot==null ? null : Number(query.tot);
  const minPopulariteit = query.minPopulariteit==='' || query.minPopulariteit==null ? null : Number(query.minPopulariteit);
  return {
    zoek:String(query.zoek||'').trim().slice(0,120),
    type:['alles','film','serie','film-serie','muziek','game'].includes(type)?type:'alles',
    studio:String(query.studio||'').trim().slice(0,80),
    artiest:String(query.artiest||'').trim().slice(0,80),
    bekendheid:['','iconisch','heel_bekend','zeer_bekend','bekend','redelijk_bekend','matig_bekend','onbekend'].includes(bekendheid)?bekendheid:'',
    mp3:['alle','ja','nee'].includes(mp3)?mp3:'alle',
    vanaf:Number.isInteger(vanaf)&&vanaf>=1900&&vanaf<=2100?vanaf:null,
    tot:Number.isInteger(tot)&&tot>=1900&&tot<=2100?tot:null,
    minPopulariteit:Number.isFinite(minPopulariteit)&&minPopulariteit>=0?minPopulariteit:null,
  };
}
function waar(filters) {
  const f = leesFilters(filters);
  const cond = [], args = [];
  function voeg(clause,value){args.push(value);cond.push(clause.replace('?', '$'+args.length))}
  if(f.zoek) voeg('(naam ILIKE ? OR artiest ILIKE ?)', '%'+f.zoek+'%'); // speciale behandeling hieronder
  if(f.zoek){cond.pop();args.pop();args.push('%'+f.zoek+'%');cond.push('(naam ILIKE $'+args.length+' OR artiest ILIKE $'+args.length+')')}
  if(f.type==='film-serie') cond.push("type IN ('film','serie')");
  else if(f.type!=='alles') voeg('type = ?',f.type);
  if(f.studio) voeg('studio ILIKE ?','%'+f.studio+'%');
  if(f.artiest) voeg('artiest ILIKE ?','%'+f.artiest+'%');
  if(f.bekendheid) {
    if(f.bekendheid==='zeer_bekend') cond.push("bekendheid IN ('zeer_bekend','heel_bekend')");
    else if(f.bekendheid==='redelijk_bekend') cond.push("bekendheid IN ('redelijk_bekend','matig_bekend')");
    else voeg('bekendheid = ?',f.bekendheid);
  }
  if(f.mp3!=='alle') cond.push('heeft_mp3 = '+(f.mp3==='ja'?'true':'false'));
  if(f.vanaf!==null) voeg('jaar >= ?',f.vanaf);
  if(f.tot!==null) voeg('jaar <= ?',f.tot);
  if(f.minPopulariteit!==null) voeg('COALESCE(populariteit,0) >= ?',f.minPopulariteit);
  return {sql:cond.length?' WHERE '+cond.join(' AND '):'',params:args,f};
}
async function zoek(pool,filters,page=1,limit=40,alleenKeys=false) {
  await init(pool);
  const {sql,params} = waar(filters);
  if(alleenKeys) {
    const {rows}=await pool.query(BASIS+' SELECT sleutel FROM alle '+sql+' ORDER BY sleutel LIMIT 15001',params);
    if(rows.length>15000) throw Error('Te veel resultaten. Gebruik extra filters.');
    return rows.map(r=>r.sleutel);
  }
  const p=Math.max(1,Math.min(10000,parseInt(page,10)||1));
  const l=Math.max(10,Math.min(100,parseInt(limit,10)||40));
  const count = await pool.query(BASIS+' SELECT count(*)::int AS totaal FROM alle '+sql,params);
  const data = await pool.query(BASIS+' SELECT * FROM alle '+sql+
     ' ORDER BY lower(naam),type,sleutel LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2),
     [...params,l,(p-1)*l]);
  return {totaal:count.rows[0].totaal, pagina:p, perPagina:l,resultaten:data.rows};
}
function keysUitSelectie(body){
  const keys=Array.isArray(body?.selectie)?body.selectie:[];
  if(keys.length>15000) throw Error('Selectie te groot.');
  if(keys.some(x=>!/^((titel|game)-[1-9]\d*)$/.test(String(x)))) throw Error('Ongeldige selectie.');
  return [...new Set(keys)];
}
function slugify(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
}
async function voegItems(client,collectieId,keys) {
  const titelIds=[],gameIds=[];
  for(const key of keys){
    const [kind,id]=key.split('-');
    if(kind==='titel') titelIds.push(Number(id));
    if(kind==='game') gameIds.push(Number(id));
  }
  let totaal=0;
  if(titelIds.length) {
    const r=await client.query(`INSERT INTO titel_collecties(titel_id,collectie_id)
      SELECT t.id,$1 FROM titels t WHERE t.id=ANY($2::int[])
      ON CONFLICT DO NOTHING`,[collectieId,titelIds]);
    totaal+=r.rowCount;
  }
  if(gameIds.length) {
    const r=await client.query(`INSERT INTO beheer_catalogus_games(collectie_id,game_id)
      SELECT $1,g.id FROM game_catalogus g WHERE g.id=ANY($2::bigint[])
      ON CONFLICT DO NOTHING`,[collectieId,gameIds]);
    totaal+=r.rowCount;
  }
  return totaal;
}
module.exports = function catalogusWorkspace(router,vereisAdmin,pool) {
  router.get('/api/admin/catalogus-workspace/titels',vereisAdmin,async(req,res)=>{
    try {res.json(await zoek(pool,req.query,req.query.pagina,req.query.perPagina))}
    catch(e){res.status(500).json({fout:e.message})}
  });
  router.get('/api/admin/catalogus-workspace/catalogi',vereisAdmin,async(_req,res)=>{
    try {
      await init(pool);
      const {rows}=await pool.query(`SELECT c.id,c.sleutel,c.naam,c.beschrijving,c.standaard_type,c.actief,
       COALESCE(b.doelgroep,c.standaard_type) AS doelgroep,b.afbeelding_url,
       (SELECT count(*)::int FROM titel_collecties tc WHERE tc.collectie_id=c.id) AS titels,
       (SELECT count(*)::int FROM beheer_catalogus_games bg WHERE bg.collectie_id=c.id) AS games
       FROM collecties c LEFT JOIN beheer_catalogus_info b ON b.collectie_id=c.id ORDER BY lower(c.naam)`);
      res.json(rows);
    } catch(e){res.status(500).json({fout:e.message})}
  });
  router.post('/api/admin/catalogus-workspace/catalogi',vereisAdmin,async(req,res)=>{
    const naam=String(req.body?.naam||'').trim().slice(0,80);
    const doelgroep=String(req.body?.doelgroep||'alles');
    if(!naam || !DOELEN.includes(doelgroep)) return res.status(400).json({fout:'Naam en geldige categorie verplicht.'});
    try {
      await init(pool);
      const keys=req.body?.alleGefilterde===true
        ? await zoek(pool,req.body.filters||{},1,40,true) : keysUitSelectie(req.body);
      if(!keys.length) return res.status(400).json({fout:'Selecteer eerst titels of pas filters aan.'});
      const slug=slugify(naam);
      if(!slug) return res.status(400).json({fout:'Ongeldige naam voor catalogus.'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const validType=['film','serie','muziek','beide'].includes(doelgroep)?doelgroep:'alles';
        const {rows}=await client.query(`INSERT INTO collecties(sleutel,naam,beschrijving,standaard_type,toevoeg_reden)
          VALUES($1,$2,$3,$4,$5) RETURNING id,naam,sleutel`,
          [slug,naam,String(req.body?.beschrijving||'').slice(0,300),validType,'Aangemaakt via de catalogusfilters']);
        const id=rows[0].id;
        await client.query('INSERT INTO beheer_catalogus_info(collectie_id,doelgroep) VALUES($1,$2)',[id,doelgroep]);
        const toegevoegd=await voegItems(client,id,keys);
        await client.query('COMMIT');
        res.status(201).json({...rows[0],doelgroep,toegevoegd});
      }catch(err){
        await client.query('ROLLBACK');
        res.status(err.code==='23505'?409:400).json({fout:err.code==='23505'?'Catalogus met deze naam bestaat al.':err.message});
      }finally{client.release()}
    }catch(e){res.status(500).json({fout:e.message})}
  });
  router.post('/api/admin/catalogus-workspace/catalogi/:id/items',vereisAdmin,async(req,res)=>{
    try{
      await init(pool);
      const keys=req.body?.alleGefilterde===true
        ?await zoek(pool,req.body.filters||{},1,40,true):keysUitSelectie(req.body);
      if(!keys.length) return res.status(400).json({fout:'Geen selectie.'});
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({fout:'Ongeldige catalogus.'});
      const r=await pool.query('SELECT id FROM collecties WHERE id=$1',[id]);
      if(!r.rowCount) return res.status(404).json({fout:'Catalogus bestaat niet.'});
      const toegevoegd=await voegItems(pool,id,keys);
      res.json({toegevoegd});
    }catch(e){res.status(500).json({fout:e.message})}
  });
  router.patch('/api/admin/catalogus-workspace/catalogi/:id',vereisAdmin,async(req,res)=>{
    try {
      await init(pool);
      const id=Number(req.params.id);
      const naam=String(req.body?.naam||'').trim().slice(0,80);
      const doelgroep=String(req.body?.doelgroep||'');
      if(!Number.isSafeInteger(id)||id<1||!naam||!DOELEN.includes(doelgroep))return res.status(400).json({fout:'Ongeldige invoer.'});
      const r=await pool.query('UPDATE collecties SET naam=$2 WHERE id=$1 RETURNING id,naam',[id,naam]);
      if(!r.rowCount)return res.status(404).json({fout:'Catalogus niet gevonden.'});
      await pool.query(`INSERT INTO beheer_catalogus_info(collectie_id,doelgroep)
        VALUES($1,$2) ON CONFLICT(collectie_id) DO UPDATE SET doelgroep=$2,bijgewerkt_op=now()`,[id,doelgroep]);
      res.json({ok:true});
    }catch(e){res.status(400).json({fout:e.message})}
  });
  router.post('/api/admin/catalogus-workspace/catalogi/:id/afbeelding',
     vereisAdmin,upload.single('afbeelding'),async(req,res)=>{
    try {
      await init(pool);
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({fout:'Ongeldige catalogus.'});
      const types={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
      const ext=types[req.file?.mimetype];
      if(!req.file||!ext) return res.status(415).json({fout:'Upload PNG, JPG of WebP (maximaal 5 MB).'});
      const exists=await pool.query('SELECT id FROM collecties WHERE id=$1',[id]);
      if(!exists.rowCount)return res.status(404).json({fout:'Catalogus bestaat niet.'});
      await fs.mkdir(UPLOAD_DIR,{recursive:true});
      const bestand='catalogus-'+id+'-'+crypto.randomUUID()+ext;
      await fs.writeFile(path.join(UPLOAD_DIR,bestand),req.file.buffer,{flag:'wx'});
      const afbeelding_url='/media/uploads/'+bestand;
      await pool.query(`INSERT INTO beheer_catalogus_info(collectie_id,afbeelding_url)
        VALUES($1,$2) ON CONFLICT(collectie_id) DO UPDATE SET afbeelding_url=$2,bijgewerkt_op=now()`,[id,afbeelding_url]);
      res.json({afbeelding_url});
    }catch(e){res.status(500).json({fout:e.message})}
  });
  router.get('/api/admin/catalogus-workspace/catalogi/:id/items',vereisAdmin,async(req,res)=>{
    try{
      await init(pool);
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({fout:'Ongeldige catalogus.'});
      const {rows}=await pool.query(`SELECT t.id::text AS id,t.naam,t.type::text AS type,t.jaar
        FROM titel_collecties tc JOIN titels t ON t.id=tc.titel_id WHERE tc.collectie_id=$1
        UNION ALL SELECT g.id::text,g.naam,'game'::text,g.jaar
        FROM beheer_catalogus_games cg JOIN game_catalogus g ON g.id=cg.game_id WHERE cg.collectie_id=$1
        ORDER BY naam LIMIT 500`,[id]);
      res.json({resultaten:rows});
    }catch(e){res.status(500).json({fout:e.message})}
  });
};
