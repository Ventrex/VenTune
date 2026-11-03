// Beheerbare teksten met expliciete sleutels. Andere teksten behouden hun standaardwaarde.
const SLEUTELS = [
  'home.titel','home.ondertitel','home.nieuw_spel','home.meedoen','home.doorgaan',
  'nav.spelen','nav.scores','nav.controleren','nav.beheer','nav.profielen','nav.inloggen',
];
async function lees(pool) {
  const {rows}=await pool.query("SELECT waarde FROM app_instellingen WHERE sleutel='site_teksten' LIMIT 1");
  const v=rows[0]?.waarde || {};
  return Object.fromEntries(SLEUTELS.filter(k=>typeof v[k]==='string').map(k=>[k,v[k]]));
}
module.exports=function siteTeksten(router,vereisAdmin,pool){
  router.get('/api/site-teksten',async(_req,res)=>{
    try{res.json(await lees(pool))}
    catch(e){res.json({})}
  });
  router.get('/api/admin/site-teksten',vereisAdmin,async(_req,res)=>{
    try{res.json(await lees(pool))}
    catch(e){res.status(500).json({fout:e.message})}
  });
  router.put('/api/admin/site-teksten',vereisAdmin,async(req,res)=>{
    try{
      const b=req.body || {};
      if(Object.keys(b).some(k=>!SLEUTELS.includes(k)))return res.status(400).json({fout:'Onbekende tekstsleutel.'});
      const tekens=Object.fromEntries(Object.entries(b).map(([key,value])=>[key,String(value||'').trim().slice(0,180)]));
      const orig=await lees(pool);
      const opgeschoond=Object.fromEntries(Object.entries({...orig,...tekens}).filter(([,value])=>value));
      await pool.query("INSERT INTO app_instellingen(sleutel,waarde,bijgewerkt_op) VALUES('site_teksten',$1::jsonb,now()) ON CONFLICT(sleutel) DO UPDATE SET waarde=$1::jsonb,bijgewerkt_op=now()",[JSON.stringify(opgeschoond)]);
      res.json(opgeschoond);
    }catch(e){res.status(500).json({fout:e.message})}
  });
};
