// Niet-destructieve controle van de bestaande Nederlandse catalogus.
const ytzoek = require('../lib/ytzoek');
const codex = require('../lib/codex');
const { pastBijTitel } = require('../lib/trackcheck');

function rangschik(t) {
  if (t.nl_verificatie === 'bevestigd' || t.nl_verificatie === 'afgewezen') {
    if (t.nl_verificatie === 'afgewezen') return 'niet_nederlands';
  }
  const score = Number(t.bekendheid_score) || 0;
  const populariteit = Number(t.populariteit) || 0;
  const stemmen = Number(t.stemmen) || 0;
  // Signalen voor internationale bekendheid; NIET hetzelfde als bewezen Nederlandse bekendheid.
  if (score >= 85 || (populariteit >= 80 && stemmen >= 1500)) return 'zeer_bekend';
  if (score >= 55 || (populariteit >= 25 && stemmen >= 200)) return 'bekend';
  if (score >= 25 || populariteit >= 6) return 'matig_bekend';
  return 'onbekend';
}
const geldigId = value => /^\d+$/.test(String(value)) && Number(value) > 0;
module.exports = function registreerCatalogusAudit(router, vereisAdmin, pool) {
  const niveaus=['iconisch','zeer_bekend','bekend','redelijk_bekend','onbekend'];
  const types=['film','serie','game'];
  let taak={bezig:false,totaal:0,verwerkt:0,geslaagd:0,fouten:0,laatsteFout:null};
  const schema={type:'object',additionalProperties:false,required:['niveau','nl_relevant','reden','bronnen','zekerheid'],properties:{
    niveau:{type:'string',enum:niveaus},nl_relevant:{type:'boolean'},
    reden:{type:'string'},zekerheid:{type:'string',enum:['hoog','middel','laag']},
    bronnen:{type:'array',items:{type:'object',additionalProperties:false,required:['url','omschrijving'],properties:{url:{type:'string'},omschrijving:{type:'string'}}}}
  }};
  async function initAI(){
    await pool.query(`CREATE TABLE IF NOT EXISTS catalogus_ai_review (
       type TEXT NOT NULL,id BIGINT NOT NULL,niveau TEXT, nl_relevant BOOLEAN,
       reden TEXT, bronnen JSONB NOT NULL DEFAULT '[]',zekerheid TEXT,
       beslissing TEXT NOT NULL DEFAULT 'open',onderzocht_op TIMESTAMPTZ,
       PRIMARY KEY(type,id))`);
  }
  async function onderzoek(type,t){
    const prompt=type==='game'
      ? `Onderzoek via LIVE WEB SEARCH het videospel "${t.naam}" (${t.jaar||'jaar onbekend'}). Hoe iconisch is het SPEL OF de herkenbare ORIGINELE MUZIEK in Nederland? Eén van beide iconisch is voldoende. Geef een van vijf niveaus. Toon betrouwbare bron-URL's die je daadwerkelijk hebt gevonden. Geen bronnen of onvoldoende informatie: zekerheid laag, geen stellige beweringen. Geen gokwerk.`
      : `Onderzoek via LIVE WEB SEARCH Nederlandse herkenbaarheid van ${type} "${t.naam}" (${t.jaar||'jaar onbekend'}), TMDB ${t.tmdb_id||'onbekend'}. ${type==='film'?'Zoek Nederlandse bioscooprelease, Nederlandse streamingdiensten (ook historisch), Nederlandse populariteit en culturele bekendheid.':'Zoek Nederlandse tv-uitzendingen, ook publieke en commerciële zenders, en Nederlandse streamingdiensten (ook historisch), en hoe bekend de serie was.'} Algemene internationale populariteit is GEEN bewijs van bekendheid in Nederland. Zoek onderbouwing, geef vijfdelig niveau iconisch/zeer_bekend/bekend/redelijk_bekend/onbekend. nl_relevant = of relevante Nederlandse verspreiding/bekendheid aannemelijk en onderbouwd is. Geen bewijs is NIET bewijs van afwezigheid. Geef exacte verifieerbare web-URL's. Onzekerheid expliciet. Geen verzinsels.`;
    const resp=await codex.vraagJson({schema,prompt});
    if(!resp.ok || !resp.data || !niveaus.includes(resp.data.niveau))throw Error(resp.error||'AI-analyse gaf geen geldig resultaat');
    const d=resp.data;
    const bronlijst=(d.bronnen||[]).filter(x=>{try{let u=new URL(x.url);return ['http:','https:'].includes(u.protocol);}catch{return false;}}).slice(0,8);
    // Zonder citeerbare bronnen nooit hoog vertrouwen toekennen.
    const zekerheid=bronlijst.length?d.zekerheid:'laag';
    await pool.query(`INSERT INTO catalogus_ai_review(type,id,niveau,nl_relevant,reden,bronnen,zekerheid,onderzocht_op)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(type,id) DO UPDATE SET
      niveau=EXCLUDED.niveau,nl_relevant=EXCLUDED.nl_relevant,reden=EXCLUDED.reden,
      bronnen=EXCLUDED.bronnen,zekerheid=EXCLUDED.zekerheid,onderzocht_op=now()`,
      [type,t.id,d.niveau,d.nl_relevant,String(d.reden).slice(0,1500),JSON.stringify(bronlijst),zekerheid]);
  }
  router.get('/api/admin/catalogus-ai',vereisAdmin,async(req,res)=>{
    try{
      await initAI();
      const {rows}=await pool.query(`SELECT r.*,CASE WHEN r.type='game' THEN g.naam ELSE t.naam END AS naam,
        CASE WHEN r.type='game' THEN g.jaar ELSE t.jaar END AS jaar
        FROM catalogus_ai_review r
        LEFT JOIN titels t ON r.type IN ('film','serie') AND t.id=r.id
        LEFT JOIN game_catalogus g ON r.type='game' AND g.id=r.id
        WHERE (t.id IS NOT NULL OR g.id IS NOT NULL)
        ORDER BY CASE r.niveau WHEN 'iconisch' THEN 1 WHEN 'zeer_bekend' THEN 2 WHEN 'bekend' THEN 3 WHEN 'redelijk_bekend' THEN 4 ELSE 5 END,r.type,naam`);
      const {rows:totalen}=await pool.query(`SELECT
        COUNT(*)::int AS onderzocht,
        COUNT(*) FILTER (WHERE niveau='onbekend')::int AS onbekend,
        COUNT(*) FILTER (WHERE niveau='redelijk_bekend' OR zekerheid='laag')::int AS twijfel,
        COUNT(*) FILTER (WHERE beslissing='weg')::int AS weg
        FROM catalogus_ai_review`);
      res.json({resultaten:rows,taak,samenvatting:totalen[0]});
    }catch(e){res.status(500).json({fout:e.message});}
  });
  router.post('/api/admin/catalogus-ai/start',vereisAdmin,async(req,res)=>{
    if(taak.bezig)return res.status(409).json({fout:'Er loopt al een AI-controle'});
    const type=String(req.body?.type||'alle');
    if(![...types,'alle'].includes(type))return res.status(400).json({fout:'Onbekend type'});
    try{
      await initAI();
      const filmSeries=type==='game'?[]:(await pool.query(`SELECT id,naam,jaar,tmdb_id,type::text AS type FROM titels WHERE type::text IN ('film','serie') ORDER BY id`)).rows.filter(x=>type==='alle'||x.type===type);
      const games=type==='alle'||type==='game'?(await pool.query("SELECT id,naam,jaar,'game' AS type FROM game_catalogus ORDER BY id")).rows:[];
      // Hervat een bestaande controle zonder afgeronde beoordelingen te overschrijven.
      const {rows:gedaan}=await pool.query("SELECT type,id FROM catalogus_ai_review WHERE onderzocht_op IS NOT NULL");
      const alOnderzocht=new Set(gedaan.map(r=>r.type+':'+r.id));
      const items=[...filmSeries,...games].filter(t=>!alOnderzocht.has(t.type+':'+t.id));
      taak={bezig:true,totaal:items.length,verwerkt:0,geslaagd:0,fouten:0,laatsteFout:null};
      res.json({gestart:true,totaal:items.length});
      setImmediate(async()=>{
        try{for(const t of items){
          try{await onderzoek(t.type,t);taak.geslaagd++;}
          catch(e){taak.fouten++;taak.laatsteFout=t.naam+': '+e.message;}
          taak.verwerkt++;
        }}finally{taak.bezig=false;}
      });
    }catch(e){res.status(500).json({fout:e.message});}
  });
  router.post('/api/admin/catalogus-ai/:type/:id/beslissing',vereisAdmin,async(req,res)=>{
    const {type,id}=req.params, beslissing=String(req.body?.beslissing||'');
    if(!types.includes(type)||!geldigId(id)||!['behouden','twijfel','weg'].includes(beslissing))return res.status(400).json({fout:'Ongeldige beoordeling'});
    try{
      await initAI();
      const result=await pool.query('UPDATE catalogus_ai_review SET beslissing=$3 WHERE type=$1 AND id=$2 RETURNING id',[type,id,beslissing]);
      if(!result.rowCount)return res.status(404).json({fout:'Eerst AI-onderzoek uitvoeren'});
      // Weg is een handmatige markering, NIET definitief verwijderen.
      res.json({ok:true,beslissing});
    }catch(e){res.status(500).json({fout:e.message});}
  });

  router.get('/api/admin/catalogus-audit', vereisAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT t.id, t.naam, t.type::text AS type, t.jaar, t.tmdb_id,
          t.populariteit, t.stemmen, t.bekendheid_score, t.bekendheidsniveau,
          t.bron_nl, t.nl_verificatie, t.nl_bewijs, t.nl_gecontroleerd_op,
          COUNT(tr.id)::int AS tracks_aantal,
          COUNT(tr.id) FILTER (WHERE tr.bron = 'lokaal' AND tr.werkt AND tr.download_status='available')::int AS mp3_aantal,
          jsonb_agg(jsonb_build_object(
            'id',tr.id,'naam',tr.tracknaam,'youtube_titel',tr.youtube_titel,
            'bron_url',tr.bron_url,'review_status',tr.review_status,
            'status',tr.download_status,'verificatie',tr.verificatie_score,
            'werkt',tr.werkt
          )) FILTER (WHERE tr.id IS NOT NULL) AS tracks
        FROM titels t LEFT JOIN tracks tr ON tr.titel_id=t.id
        WHERE t.type::text IN ('film','serie')
        GROUP BY t.id ORDER BY t.naam`);
      res.json(rows.map(t => {
        const tracks = t.tracks || [];
        const problemen = [];
        if (!t.tmdb_id) problemen.push('Geen TMDB-koppeling');
        if (!t.mp3_aantal) problemen.push('Geen beschikbare lokale MP3');
        if (!tracks.length) problemen.push('Geen muziekkoppeling');
        if (tracks.some(x => !x.youtube_titel)) problemen.push('YouTube-videotitel ontbreekt');
        if (tracks.some(x => x.review_status !== 'goedgekeurd' && x.review_status !== 'handmatig')) problemen.push('Track niet handmatig goedgekeurd');
        if (tracks.some(x => x.naam && !pastBijTitel(t, {tracknaam:x.naam}).past)) problemen.push('Muziekmatch controleren');
        return {...t, niveau:rangschik(t), problemen, tracks};
      }));
    } catch(e) { res.status(500).json({fout:e.message}); }
  });

  router.post('/api/admin/catalogus-audit/:id/controleer-nl', vereisAdmin, async (req, res) => {
    if (!geldigId(req.params.id)) return res.status(400).json({fout:'Ongeldig ID'});
    try {
      const { rows } = await pool.query('SELECT id, type::text AS type, tmdb_id FROM titels WHERE id=$1',[req.params.id]);
      const titel=rows[0];
      if (!titel) return res.status(404).json({fout:'Titel niet gevonden'});
      if (!titel.tmdb_id) return res.status(422).json({fout:'Koppel eerst de juiste TMDB-titel'});
      if (!process.env.TMDB_API_KEY) return res.status(503).json({fout:'TMDB_API_KEY ontbreekt'});
      const isFilm=titel.type==='film';
      const pad=isFilm ? `movie/${titel.tmdb_id}/release_dates` : `tv/${titel.tmdb_id}`;
      const key=process.env.TMDB_API_KEY;
      const bearer=key.startsWith('eyJ');
      const url=new URL(`https://api.themoviedb.org/3/${pad}`);
      if (!bearer) url.searchParams.set('api_key',key);
      const response=await fetch(url,{headers:bearer?{Authorization:`Bearer ${key}`}:{}});
      if (!response.ok) throw new Error(`TMDB antwoordde met HTTP ${response.status}`);
      const data=await response.json();
      let resultaat='onbevestigd', bewijs='';
      if (isFilm) {
        const nl=data.results?.find(r=>r.iso_3166_1==='NL');
        const bios=nl?.release_dates?.find(r=>r.type===3);
        if (bios) {resultaat='bevestigd';bewijs=`TMDB: Nederlandse bioscooprelease ${bios.release_date?.slice(0,10)||''} (release type 3)`;}
        else bewijs='TMDB bevat geen bevestigde Nederlandse bioscooprelease; dit betekent niet dat de film niet draaide.';
      } else {
        bewijs='TMDB bevestigt geen historische uitzending op Nederlandse televisie. Handmatige broncontrole nodig.';
      }
      const updated=await pool.query('UPDATE titels SET nl_verificatie=$2, nl_bewijs=$3, nl_gecontroleerd_op=NOW() WHERE id=$1 RETURNING nl_verificatie,nl_bewijs',[titel.id,resultaat,bewijs]);
      res.json(updated.rows[0]);
    } catch(e) {res.status(502).json({fout:e.message});}
  });

  router.post('/api/admin/catalogus-audit/:id/beoordeel', vereisAdmin, async(req,res)=>{
    if(!geldigId(req.params.id)) return res.status(400).json({fout:'Ongeldig ID'});
    const {status,bewijs}=req.body||{};
    if(!['bevestigd','afgewezen','onbevestigd'].includes(status)) return res.status(400).json({fout:'Ongeldige status'});
    if(status==='bevestigd' && !String(bewijs||'').trim()) return res.status(400).json({fout:'Vul een verifieerbare Nederlandse bron in'});
    try {
      const r=await pool.query('UPDATE titels SET nl_verificatie=$2,nl_bewijs=$3,nl_gecontroleerd_op=NOW() WHERE id=$1 RETURNING id',[req.params.id,status,String(bewijs||'').slice(0,1500)]);
      if(!r.rowCount) return res.status(404).json({fout:'Titel niet gevonden'});
      res.json({ok:true});
    }catch(e){res.status(500).json({fout:e.message});}
  });

  router.get('/api/admin/catalogus-audit/:id/muziek-zoek',vereisAdmin,async(req,res)=>{
    if(!geldigId(req.params.id)) return res.status(400).json({fout:'Ongeldig ID'});
    try{
      const {rows}=await pool.query('SELECT id,naam,type::text AS type,jaar,aliassen FROM titels WHERE id=$1',[req.params.id]);
      if(!rows[0]) return res.status(404).json({fout:'Titel niet gevonden'});
      const t=rows[0];
      const termen=ytzoek.zoektermenVoor(t);
      const resultaten=await ytzoek.zoek(termen[0],{limiet:8});
      const kandidaten=(resultaten||[]).map(r=>({...r,controle:pastBijTitel(t,{tracknaam:r.titel,artiest:r.kanaal})})).slice(0,8);
      res.json({zoekterm:termen[0],kandidaten,advies:ytzoek.kiesBeste(resultaten,t)});
    }catch(e){res.status(502).json({fout:e.message});}
  });
};
