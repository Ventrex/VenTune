// Niet-destructieve controle van de bestaande Nederlandse catalogus.
const ytzoek = require('../lib/ytzoek');
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
