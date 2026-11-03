// Niet-gevoelige auditregistratie van beheeracties en serverfouten.
// Bewaart uitsluitend methode, route, HTTP-status en duur; nooit inhoud of tokens.
let ready;
function init(pool){
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS beheer_activiteit_log(
    id BIGSERIAL PRIMARY KEY, datum TIMESTAMPTZ NOT NULL DEFAULT now(),
    niveau TEXT NOT NULL, bron TEXT NOT NULL DEFAULT 'api',
    actor TEXT NOT NULL DEFAULT 'beheersessie',
    actie TEXT NOT NULL, status INTEGER, duur_ms INTEGER,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
  )`).then(()=>pool.query('CREATE INDEX IF NOT EXISTS idx_beheer_activiteit_log_datum ON beheer_activiteit_log(datum DESC)'))
    .catch(e=>{ready=null;throw e});
  return ready;
}
module.exports=function registreerBeheerLogs(router,vereisAdmin,pool){
  router.use((req,res,next)=>{
    // Log niet op elk dashboard-refreshmoment. Serverfouten blijven wel zichtbaar.
    if(!req.path.startsWith('/api/admin/'))return next();
    const start=Date.now();
    res.once('finish',()=>{
      const code=Number(res.statusCode)||200;
      if(req.method==='GET' && code<500)return;
      if(/\/(login|wachtwoord|logout|sessie)\b/i.test(req.path))return;
      const niveau=code>=500?'ERROR':code>=400?'WARNING':'INFO';
      const cleanPath=req.path.replace(/\/\d{1,15}(?=\/|$)/g,'/:id');
      init(pool).then(()=>pool.query(`INSERT INTO beheer_activiteit_log
        (niveau,actor,actie,status,duur_ms,details)
        VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [niveau,code>=400?'onbekend':'beheersessie',req.method+' '+cleanPath,
         code,Math.min(600000,Date.now()-start),JSON.stringify({methode:req.method})]))
        .catch(()=>{ /* Auditfout mag API-verzoek niet verstoren */ });
    });
    next();
  });
  router.get('/api/admin/beheer-logs',vereisAdmin,async(req,res)=>{
    try{
      await init(pool);
      const {niveau='',zoek='',actor='',vanaf=''}=req.query;
      const params=[],where=[];
      function add(column,val){params.push(val);where.push(column+' = $'+params.length)}
      if(['INFO','WARNING','ERROR'].includes(String(niveau)))add('niveau',String(niveau));
      if(['beheersessie','onbekend'].includes(String(actor)))add('actor',String(actor));
      if(String(zoek).trim()){
        params.push('%'+String(zoek).trim().slice(0,120)+'%');
        where.push('actie ILIKE $'+params.length);
      }
      if(/^\d{4}-\d{2}-\d{2}$/.test(String(vanaf))){
        params.push(String(vanaf));where.push('datum >= $'+params.length+'::date');
      }
      const pagina=Math.max(1,Math.min(10000,parseInt(req.query.pagina,10)||1));
      const perPagina=50;
      const sql=where.length?' WHERE '+where.join(' AND '):'';
      const total=await pool.query('SELECT count(*)::int AS n FROM beheer_activiteit_log '+sql,params);
      const list=await pool.query('SELECT id,datum,niveau,bron,actor,actie,status,duur_ms,details FROM beheer_activiteit_log '+sql+
        ' ORDER BY datum DESC LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2),
        [...params,perPagina,(pagina-1)*perPagina]);
      res.json({totaal:total.rows[0].n,pagina,perPagina,resultaten:list.rows,
        toelichting:'Beheer-API acties en fouten. Containerlogs en uitvoer van achtergrondprocessen vallen hier nog niet volledig onder.'});
    }catch(e){res.status(500).json({fout:e.message})}
  });
};
