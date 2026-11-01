import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand.jsx';

// =====================================================================
// Beheer: ChatGPT koppelen (device-login vanaf de site) + aanbevelingen
// genereren. Mobiel én desktop vriendelijk.
// =====================================================================

async function jsonOfNull(r) { try { return await r.json(); } catch { return null; } }
async function haal(pad, opties = {}) {
    const r = await fetch(pad, { credentials: 'include', ...opties });
    const d = await jsonOfNull(r);
    if (!r.ok) throw new Error((d && d.fout) || 'Er ging iets mis.');
    return d;
}
const jsonBody = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export default function AdminAI() {
    const [ingelogd, setIngelogd] = useState(null); // null = onbekend

    useEffect(() => {
        haal('/api/admin/sessie').then((s) => setIngelogd(!!(s && s.ingelogd)))
            .catch(() => setIngelogd(false));
    }, []);

    if (ingelogd === null) return <main className="scherm"><p className="dim">Laden…</p></main>;
    if (!ingelogd) return <Login onOk={() => setIngelogd(true)} />;
    return <Paneel />;
}

function Login({ onOk }) {
    const [ww, setWw] = useState('');
    const [fout, setFout] = useState('');
    async function login(e) {
        e.preventDefault();
        try { await haal('/api/admin/login', { method: 'POST', ...jsonBody({ wachtwoord: ww }) }); onOk(); }
        catch (err) { setFout(err.message); }
    }
    return (
        <main className="scherm auth-scherm">
            <Brand link={false} />
            <h1>Beheer</h1>
            {fout && <p className="waarschuwing">{fout}</p>}
            <form onSubmit={login} className="stapel">
                <input className="invoer" type="password" placeholder="Wachtwoord"
                       value={ww} onChange={(e) => setWw(e.target.value)} autoFocus />
                <button className="knop" type="submit">Inloggen</button>
                <Link className="terug" to="/">← Terug</Link>
            </form>
        </main>
    );
}

function Paneel() {
    return (
        <main className="scherm admin-ai">
            <div className="ai-kop">
                <Brand link compact />
                <Link className="terug" to="/admin">Volledig beheer →</Link>
            </div>
            <h1>Beheer</h1>

            <section className="kaart ai-kaart" style={{ marginBottom: '1rem' }}>
                <p className="kaart-label">Zo vul je de quiz — in 4 stappen</p>
                <ol className="uitleg-stappen">
                    <li><strong>Koppel ChatGPT</strong> (één keer). Dan kan de AI nummers voor je zoeken.</li>
                    <li><strong>Haal nummers op.</strong> Kies een categorie en het gewenste aantal. De AI zoekt bekende herkenningsnummers.</li>
                    <li><strong>Swipe ze.</strong> Eerst blind (ken je het?), daarna de rest mét naam (goed/fout/onbekend). Goedgekeurde nummers komen vanzelf in de quiz.</li>
                    <li><strong>Twijfel je?</strong> Deel de review-link; vrienden luisteren en stemmen.</li>
                </ol>
            </section>

            <div className="ai-grid">
                <ChatGptKoppeling />
                <Genereren />
            </div>
            <CatalogusPerJaar />
            <QuizInhoud />
            <HerkenbaarheidBeheer />
            <MetadataVerrijken />
            <HandmatigToevoegen />
            <GamesCatalogus />
            <Database />
        </main>
    );
}

// ------------------------- Database (simpel) -------------------------

export function HerkenbaarheidBeheer() {
    const [zoek, setZoek] = useState('');
    const [resultaten, setResultaten] = useState(null);
    const [fout, setFout] = useState('');
    async function laad(e) {
        e?.preventDefault();
        setFout('');
        try {
            const r = await haal('/api/admin/herkenbaarheid?zoek=' + encodeURIComponent(zoek));
            setResultaten(r.resultaten || []);
        } catch (err) { setFout(err.message); }
    }
    return <section className="kaart ai-kaart" style={{marginTop:'1rem'}}>
        <h2>Herkenbaarheid per leeftijdsgroep</h2>
        <p className="dim">Een onbekend nummer wordt niet verwijderd. Pas vanaf acht stemmen per leeftijdsgroep krijgt de feedback invloed op de selectie.</p>
        <form className="zoekbalk" onSubmit={laad}>
            <input className="invoer" value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="Zoek een titel…" />
            <button className="knop" type="submit">Bekijk stemmen</button>
        </form>
        {fout && <p className="waarschuwing">{fout}</p>}
        {resultaten && (resultaten.length ? <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',textAlign:'left'}}>
                <thead><tr><th>Titel</th><th>Leeftijd</th><th>Stemmen</th><th>Onbekend</th></tr></thead>
                <tbody>{resultaten.map((r,i)=><tr key={i}>
                    <td>{r.naam}</td><td>{r.leeftijdsgroep}</td><td>{r.stemmen}</td>
                    <td>{r.onbekend} ({Math.round(r.onbekend/r.stemmen*100)}%)</td>
                </tr>)}</tbody>
            </table>
        </div> : <p className="dim">Er zijn nog geen beoordelingen.</p>)}
    </section>;
}

function QuizGezondheid() {
    const [data, setData] = useState(null);
    const [fout, setFout] = useState('');
    const [actief, setActief] = useState(false);
    async function check() {
        try { setData(await haal('/api/admin/quiz-gezondheid')); setFout(''); }
        catch (err) { setFout(err.message); }
    }
    useEffect(() => { check(); }, []);
    async function herstelInhoud() {
        setActief(true);
        try {
            await haal('/api/admin/ai-vragen/start', { method:'POST', ...jsonBody({ limiet:500 }) });
            setFout('Generatie gestart op de server. Ga gerust naar een andere pagina; controleer later opnieuw.');
        } catch (err) { setFout(err.message); }
        finally { setActief(false); }
    }
    return <section className="kaart vt-health">
        <h3>Database controleren en herstellen</h3>
        <p className="dim">Ook reeds gegenereerde, maar nog niet goedgekeurde hints en vragen worden afzonderlijk geteld.</p>
        <div className="vt-health-grid">
            <span>Zonder lokale MP3 <strong>{data?.zonder_mp3 ?? '—'}</strong></span>
            <span>Minder dan 3 hints <strong>{data?.zonder_3_hints ?? '—'}</strong></span>
            <span>Hints ter controle <strong>{data?.hints_ter_controle ?? '—'}</strong></span>
            <span>Minder dan 3 vragen <strong>{data?.zonder_3_vragen ?? '—'}</strong></span>
            <span>Vragen ter controle <strong>{data?.vragen_ter_controle ?? '—'}</strong></span>
        </div>
        <div className="knoprij">
            <button className="knop knop-stil" onClick={check}>Opnieuw controleren</button>
            <button className="knop knop-stil" disabled={actief} onClick={herstelInhoud}>Ontbrekende hints/vragen aanvullen</button>
            <Link className="knop knop-stil" to="/admin">MP3 herstellen in beheer</Link>
        </div>
        {fout && <p className="dim">{fout}</p>}
        {!!data?.problemen?.length && <details><summary>{data.problemen.length} titels met aandachtspunten (maximaal 250)</summary>
            <div className="vt-health-list">{data.problemen.map(t => <p key={t.id}>
                <strong>{t.naam}</strong> · {!t.heeft_mp3 ? 'geen MP3 · ' : ''}
                {t.hints}/3 hints {t.ai_hints_status !== 'goedgekeurd' ? '(controle nodig)' : ''} ·
                {t.vragen}/3 vragen ({t.vragen_goedgekeurd} goedgekeurd)
            </p>)}</div>
        </details>}
    </section>;
}

export function QuizInhoud() {
    const [zoek, setZoek] = useState('');
    const [data, setData] = useState([]);
    const [fout, setFout] = useState('');
    const [melding, setMelding] = useState('');
    const [batch, setBatch] = useState(null);
    const [geladen, setGeladen] = useState(false);
    const [wijzigingen, setWijzigingen] = useState({});
    const timer = useRef(null);
    const laadBatch = async () => {
        try {
            const b = await haal('/api/admin/ai-vragen/status');
            setBatch(b);
            if (!b.bezig && timer.current) { clearInterval(timer.current); timer.current = null; }
        } catch (err) { setFout(err.message); }
    };
    useEffect(() => { laadBatch(); timer.current = setInterval(laadBatch, 2500); return () => { if (timer.current) clearInterval(timer.current); }; }, []);
    async function starten() {
        setFout(''); setMelding('');
        try {
            await haal('/api/admin/ai-vragen/start', { method: 'POST', ...jsonBody({limiet: 500}) });
            await laadBatch();
            if (!timer.current) timer.current = setInterval(laadBatch, 2500);
            setMelding('AI-generatie gestart. Geldige hints en vragen worden direct aan de quiz gekoppeld.');
        } catch (err) { setFout(err.message); }
    }
    async function zoeken(e) {
        e?.preventDefault(); setFout('');
        try {
            const r = await haal('/api/admin/quiz-inhoud?zoek=' + encodeURIComponent(zoek));
            setData(r.titels || []); setGeladen(true);
        } catch (err) { setFout(err.message); }
    }
    async function beoordelen(pad, status) {
        setFout(''); setMelding('');
        try {
            await haal(pad, { method: 'POST', ...jsonBody({ status }) });
            setMelding('Beoordeling opgeslagen.');
            await zoeken();
            await laadBatch();
        } catch (err) { setFout(err.message); }
    }
    async function bewaarHints(t) {
        const hints = t.ai_hints.map((h,i) => wijzigingen['h'+t.id+'-'+i] ?? h);
        try {
            await haal('/api/admin/ai-hints/' + t.id, {method:'PATCH', ...jsonBody({hints})});
            setMelding('Hints aangepast: controle opnieuw vereist.'); await zoeken();
        } catch(err) {setFout(err.message);}
    }
    async function bewaarVraag(v) {
        const basis='v'+v.id+'-';
        const vraag=wijzigingen[basis+'vraag'] ?? v.vraag;
        const opties=v.opties.map((o,i)=>wijzigingen[basis+i] ?? o);
        const correct_index=Number(wijzigingen[basis+'correct'] ?? v.correct_index);
        try {
            await haal('/api/admin/ai-vraag/'+v.id,{method:'PATCH',...jsonBody({vraag,opties,correct_index})});
            setMelding('Vraag aangepast: controle opnieuw vereist.'); await zoeken();
        } catch(err){setFout(err.message);}
    }
    return <section className="kaart ai-kaart" style={{ marginTop:'1rem' }}>
        <h2>AI · Hints en bonusvragen</h2>
        <QuizGezondheid />
        <p className="dim">Drie verschillende hints en drie bonusvragen met zes keuzes per film/serie. Gegenereerde hints en vragen zijn direct speelbaar. Spelers kunnen fouten tijdens de quiz melden.</p>
        {batch && <p className="dim">Bibliotheek: {batch.database?.titels ?? '—'} titels · {batch.database?.hints_gegenereerd ?? 0} met 3 gegenereerde hints ({batch.database?.hints_goedgekeurd ?? 0} goedgekeurd) · {batch.database?.vragen_gegenereerd ?? 0} met 3 gegenereerde AI-vragen ({batch.database?.vragen_goedgekeurd ?? 0} goedgekeurd)</p>}
        <button className="knop" disabled={batch?.bezig} onClick={starten}>{batch?.bezig ? 'Generatie loopt…' : 'Ontbrekende hints en vragen genereren'}</button>
        {batch && <p className="dim">{batch.bezig ? 'Bezig · ' : 'Laatste batch · '}Voortgang {batch.verwerkt}/{batch.totaal} · {batch.gelukt} sets aangemaakt · {batch.mislukt} niet gelukt</p>}
        {!!batch?.fouten?.length && <details><summary>{batch.fouten.length} meldingen</summary>{batch.fouten.map((e,i)=><p key={i}>{e.id}: {e.fout}</p>)}</details>}
        <form className="zoekbalk" onSubmit={zoeken} style={{marginTop:'1rem'}}>
            <input className="invoer" value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="Zoek film of serie…" />
            <button className="knop" type="submit">Bekijken</button>
        </form>
        {fout && <p className="waarschuwing">{fout}</p>}
        {melding && <p className="dim">{melding}</p>}
        {geladen && !data.length && <p className="dim">Geen titels gevonden.</p>}
        {data.map(t=><details key={t.id} style={{marginTop:'.7rem'}}>
            <summary>{t.naam} ({t.jaar || 'jaar onbekend'}) · {(t.ai_hints||[]).length} hints · {(t.vragen||[]).filter(v=>v.status).length} AI-vragen</summary>
            <p><strong>Hints</strong> · {t.ai_hints_status || 'controle nodig'}</p>
            {(t.ai_hints||[]).map((h,i)=><input key={i} className="invoer" style={{display:'block',marginBottom:'.4rem'}} defaultValue={h} onChange={e=>setWijzigingen(w=>({...w,['h'+t.id+'-'+i]:e.target.value}))}/>)}
            <div className="ai-knoprij">
                <button className="knop knop-stil" type="button" onClick={()=>bewaarHints(t)}>Hints opslaan</button>
                <button className="knop" type="button" onClick={()=>beoordelen('/api/admin/ai-hints/'+t.id+'/beoordeel','goedgekeurd')}>Hints goedkeuren</button>
                <button className="knop knop-stil" type="button" onClick={()=>beoordelen('/api/admin/ai-hints/'+t.id+'/beoordeel','afgekeurd')}>Afkeuren</button>
            </div>
            <p><strong>Bonusvragen</strong></p>
            {(t.vragen||[]).filter(v=>v.status).map(v=><div className="kaart" key={v.id} style={{marginBottom:'.65rem',padding:'.7rem'}}>
                <p className="dim">Status: {v.status}</p>
                <input className="invoer" defaultValue={v.vraag} onChange={e=>setWijzigingen(w=>({...w,['v'+v.id+'-vraag']:e.target.value}))}/>
                {(v.opties||[]).map((opt,i)=><input className="invoer" key={i} style={{display:'block',marginTop:'.3rem'}} defaultValue={opt} onChange={e=>setWijzigingen(w=>({...w,['v'+v.id+'-'+i]:e.target.value}))}/>)}
                <label>Correcte optie (1–6) <select className="invoer" defaultValue={v.correct_index} onChange={e=>setWijzigingen(w=>({...w,['v'+v.id+'-correct']:e.target.value}))}>{[0,1,2,3,4,5].map(i=><option key={i} value={i}>{i+1}</option>)}</select></label>
                <div className="ai-knoprij">
                    <button type="button" className="knop knop-stil" onClick={()=>bewaarVraag(v)}>Vraag opslaan</button>
                    <button type="button" className="knop" onClick={()=>beoordelen('/api/admin/ai-vraag/'+v.id+'/beoordeel','goedgekeurd')}>Goedkeuren</button>
                    <button type="button" className="knop knop-stil" onClick={()=>beoordelen('/api/admin/ai-vraag/'+v.id+'/beoordeel','afgekeurd')}>Afkeuren</button>
                </div>
            </div>)}
        </details>)}
    </section>;
}

function MetadataVerrijken() {
    const [status, setStatus] = useState(null);
    const [melding, setMelding] = useState('');
    const timer = useRef(null);
    useEffect(() => {
        const kijk = async () => {
            try {
                const r = await haal('/api/admin/metadata-verrijken/status');
                setStatus(r);
                if (!r.bezig) clearInterval(timer.current);
            } catch { /* server tijdelijk niet bereikbaar */ }
        };
        kijk();
        return () => clearInterval(timer.current);
    }, []);
    async function start() {
        setMelding('');
        try {
            await haal('/api/admin/metadata-verrijken/start', { method: 'POST' });
            clearInterval(timer.current);
            timer.current = setInterval(async () => {
                try {
                    const r = await haal('/api/admin/metadata-verrijken/status');
                    setStatus(r);
                    if (!r.bezig) clearInterval(timer.current);
                } catch { clearInterval(timer.current); }
            }, 2500);
        } catch (err) { setMelding(err.message); }
    }
    useEffect(() => () => clearInterval(timer.current), []);
    return <section className="kaart ai-kaart" style={{ marginTop: '1rem' }}>
        <p className="kaart-label">Metadata aanvullen</p>
        <p className="dim">Vul ontbrekende jaartallen, alle gecontroleerde genres, studio, omschrijving en poster van films en series aan via TMDB. Maximaal 100 titels per ronde. Bestaande goedkeuringen blijven behouden.</p>
        <button className="knop knop-stil" disabled={status?.bezig} onClick={start}>Ontbrekende gegevens aanvullen</button>
        {status && <p className="dim">{status.klaar}/{status.totaal} gecontroleerd · {status.aangepast} bijgewerkt · {status.gemist} niet gevonden {status.bezig ? '· bezig' : ''}</p>}
        {melding && <p className="waarschuwing">{melding}</p>}
    </section>;
}

function Database() {
    const [tel, setTel] = useState(null);
    const [bevestig, setBevestig] = useState(false);
    const [bezig, setBezig] = useState(false);
    const [melding, setMelding] = useState('');
    const [audioHerstel, setAudioHerstel] = useState(null);

    async function ververs() {
        try { setTel(await haal('/api/admin/db-overzicht')); } catch { /* */ }
    }
    useEffect(() => { ververs(); }, []);

    async function schoonBegin() {
        setBezig(true); setMelding('');
        try {
            await haal('/api/admin/database/opschonen', {
                method: 'POST', ...jsonBody({ actie: 'schoon_begin', bevestiging: 'SCHOON' }),
            });
            setMelding('Database is leeg. Haal nu nieuwe AI-aanbevelingen op.');
            setBevestig(false);
            ververs();
        } catch (e) { setMelding(e.message); }
        setBezig(false);
    }

    async function herstelAudio() {
        setMelding('Audioherstel gestart. Bestaande nummers blijven behouden bij een downloadfout.');
        try {
            await haal('/api/admin/audio-herstel/start', { method: 'POST' });
            const check = async () => {
                const toestand = await haal('/api/admin/audio-herstel/status');
                setAudioHerstel(toestand);
                if (!toestand.bezig) clearInterval(audioHerstelTimer.current);
            };
            await check();
            audioHerstelTimer.current = setInterval(check, 3000);
        } catch (err) { setMelding(err.message); }
    }
    const audioHerstelTimer = useRef(null);
    useEffect(() => () => clearInterval(audioHerstelTimer.current), []);

    return (
        <section className="kaart ai-kaart" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">Database</p>
            {!tel ? <p className="dim">Laden…</p> : (
                <div className="ai-tellers" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <Teller label="Titels" n={tel.titels} />
                    <Teller label="Nummers" n={tel.nummers} />
                    <Teller label="Speelbaar" n={tel.speelbaar} />
                    <Teller label="Downloadfouten" n={tel.downloadfouten} />
                </div>
            )}

            <button className="knop knop-stil" disabled={audioHerstel?.bezig} onClick={herstelAudio} style={{ marginTop: '1rem' }}>Herstel korte MP3's (volledige nummers)</button>
            {audioHerstel && <p className="dim">Herstel: {audioHerstel.verwerkt}/{audioHerstel.totaal} verwerkt · {audioHerstel.hersteld} vervangen · {audioHerstel.mislukt} mislukt</p>}

            {!bevestig ? (
                <button className="knop knop-stil gevaar" style={{ marginTop: '1rem' }}
                        onClick={() => setBevestig(true)}>
                    Schoon beginnen (alles wissen)
                </button>
            ) : (
                <div className="kaart" style={{ marginTop: '1rem', borderColor: 'var(--fout, #e24b4b)' }}>
                    <p style={{ marginTop: 0 }}>
                        Weet je het zeker? Dit wist <strong>alle titels, nummers en aanbevelingen</strong>.
                        Je hostaccount en instellingen blijven staan.
                    </p>
                    <div className="ai-knoprij">
                        <button className="knop gevaar" disabled={bezig} onClick={schoonBegin}>
                            {bezig ? 'Bezig…' : 'Ja, alles wissen'}
                        </button>
                        <button className="knop knop-stil" onClick={() => setBevestig(false)}>Annuleer</button>
                    </div>
                </div>
            )}
            {melding && <p className="feedback neutraal" style={{ marginTop: '0.75rem' }}>{melding}</p>}
        </section>
    );
}

// ----------------------- ChatGPT koppelen -----------------------

export function ChatGptKoppeling() {
    const [status, setStatus] = useState(null);
    const [login, setLogin] = useState(null); // {status,url,code,error,regels}
    const poll = useRef(null);

    async function ververs() {
        try { setStatus(await haal('/api/admin/aanbevelingen/status')); } catch { /* */ }
    }
    useEffect(() => { ververs(); return () => clearInterval(poll.current); }, []);

    async function koppel() {
        try {
            const s = await haal('/api/admin/aanbevelingen/login/start', { method: 'POST' });
            setLogin(s);
            clearInterval(poll.current);
            poll.current = setInterval(async () => {
                try {
                    const st = await haal('/api/admin/aanbevelingen/login/status');
                    setLogin(st);
                    if (st.status === 'done' || st.status === 'error') {
                        clearInterval(poll.current);
                        ververs();
                    }
                } catch { /* */ }
            }, 2000);
        } catch (e) { setLogin({ status: 'error', error: e.message }); }
    }

    async function ontkoppel() {
        await haal('/api/admin/aanbevelingen/login/uit', { method: 'POST' }).catch(() => {});
        setLogin(null); ververs();
    }

    const gekoppeld = status && status.chatgpt && status.chatgpt.gekoppeld;

    return (
        <section className="kaart ai-kaart">
            <p className="kaart-label">ChatGPT-koppeling</p>

            <div className="ai-status-rij">
                <span className={'ai-stip ' + (gekoppeld ? 'aan' : 'uit')} />
                <strong>{gekoppeld ? 'Gekoppeld' : 'Niet gekoppeld'}</strong>
            </div>
            <p className="dim ai-uitleg">
                Aanbevelingen draaien via je eigen ChatGPT-account (Codex CLI,
                geen API-key). Je logt één keer in vanaf deze pagina.
            </p>

            {!gekoppeld && (!login || login.status === 'error') && (
                <button className="knop" onClick={koppel}>Koppel ChatGPT</button>
            )}

            {login && login.status !== 'done' && login.status !== 'error' && (
                <div className="ai-login">
                    {login.url && login.code ? (
                        <>
                            <p>1. Open deze link en log in bij ChatGPT:</p>
                            <a className="knop knop-stil ai-link" href={login.url} target="_blank" rel="noreferrer">
                                Open inlogpagina ↗
                            </a>
                            <p style={{ marginTop: '0.75rem' }}>2. Voer deze code in:</p>
                            <div className="ai-code">{login.code}</div>
                            <p className="dim">Daarna bevestig je in ChatGPT. Dit scherm springt vanzelf op “gekoppeld”.</p>
                        </>
                    ) : (
                        <p className="dim">Bezig met starten… een moment.</p>
                    )}
                </div>
            )}

            {login && login.status === 'error' && (
                <p className="waarschuwing" style={{ marginTop: '1rem' }}>{login.error || 'Inloggen mislukt.'}</p>
            )}

            {gekoppeld && (
                <button className="knop knop-stil" onClick={ontkoppel} style={{ marginTop: '0.5rem' }}>
                    Ontkoppelen
                </button>
            )}
        </section>
    );
}

// ------------------------- Aanbevelingen -------------------------

export function GamesCatalogus() {
    const [platformen,setPlatformen]=useState([]);
    const [games,setGames]=useState([]);
    const [naam,setNaam]=useState('');
    const [jaar,setJaar]=useState('');
    const [gekozen,setGekozen]=useState(['PC']);
    const [melding,setMelding]=useState('');
    async function laad() {
        try {
            const [p,g]=await Promise.all([haal('/api/admin/games/platformen'),haal('/api/admin/games')]);
            setPlatformen(p);setGames(g);
        }catch(err){setMelding(err.message);}
    }
    useEffect(()=>{laad();},[]);
    async function aiZoeken() {
        setMelding('AI zoekt bekende videogames. Dit loopt door op de server zolang deze draait.');
        try {
            await haal('/api/admin/games/ai-genereren',{method:'POST',...jsonBody({aantal:20})});
            setMelding('AI-opdracht gestart. Ververs de gamelijst later; de server verwerkt de resultaten.');
        }catch(err){setMelding('AI-opdracht mislukt: '+err.message);}
    }
    async function voegToe(e) {
        e.preventDefault();
        try {
            await haal('/api/admin/games',{method:'POST',...jsonBody({naam,jaar:jaar||null,platformen:gekozen})});
            setMelding('Videogame toegevoegd aan de videogamecatalogus.');
            setNaam('');setJaar('');await laad();
        }catch(err){setMelding(err.message);}
    }
    async function beoordeel(id,status) {
        try{await haal('/api/admin/games/'+id,{method:'PATCH',...jsonBody({status})});await laad();}
        catch(err){setMelding(err.message);}
    }
    return <section className="kaart ai-kaart">
        <h3>Videogames · Consoles en PC</h3>
        <p className="dim">Eigen categorie, los van films en series. Kies alle platformen waarop het spel uitkwam. Muziek en gamefragmenten zijn nog niet gekoppeld aan de spelronde.</p>
        <div className="knoprij">
            <button className="knop" onClick={aiZoeken}>AI: 20 bekende games zoeken</button>
            <Link className="knop knop-stil" to="/admin/swipe">Naar videogame-Swipe</Link>
            <button className="knop knop-stil" onClick={laad}>Games verversen</button>
        </div>
        <form onSubmit={voegToe} className="stapel">
            <input className="invoer" placeholder="Naam van het spel" value={naam} onChange={e=>setNaam(e.target.value)} required />
            <input className="invoer" placeholder="Uitgavejaar (optioneel)" type="number" min="1970" max="2100" value={jaar} onChange={e=>setJaar(e.target.value)} />
            <div className="vt-game-platforms">{platformen.map(p=><label key={p}><input type="checkbox" checked={gekozen.includes(p)} onChange={e=>setGekozen(old=>e.target.checked?[...old,p]:old.filter(x=>x!==p))} /> {p}</label>)}</div>
            <button className="knop" disabled={!gekozen.length}>Videogame toevoegen</button>
        </form>
        {melding && <p className="dim">{melding}</p>}
        <details><summary>Videogames ({games.length} getoond)</summary><div className="vt-health-list">{games.map(g=><p key={g.id}><strong>{g.naam}</strong> ({g.jaar||'—'}) · {g.platformen.join(', ')} · {g.status} {g.status==='nieuw' && <>
            <button className="knop knop-stil" onClick={()=>beoordeel(g.id,'goedgekeurd')}>Goed</button>
            <button className="knop knop-stil" onClick={()=>beoordeel(g.id,'uitgesloten')}>Afwijzen</button>
        </>}</p>)}</div></details>
    </section>;
}

function HandmatigToevoegen() {
    const [titel, setTitel] = useState('');
    const [type, setType] = useState('film');
    const [jaar, setJaar] = useState('');
    const [melding, setMelding] = useState('');
    const [bezig, setBezig] = useState(false);
    async function opslaan(e) {
        e.preventDefault();
        setBezig(true); setMelding('');
        try {
            const r = await haal('/api/admin/aanbevelingen/handmatig', {
                method: 'POST', ...jsonBody({ titel, type, jaar: jaar || null }),
            });
            setMelding(r.toelichting);
            setTitel(''); setJaar('');
        } catch (err) { setMelding(err.message); }
        finally { setBezig(false); }
    }
    return <section className="kaart ai-kaart" style={{ marginTop: '1rem' }}>
        <p className="kaart-label">Zelf een film of serie toevoegen</p>
        <p className="dim">Controleert dubbelen en zet de titel klaar om een correcte intro of soundtrack te zoeken.</p>
        <form className="stapel" onSubmit={opslaan}>
            <input className="invoer" value={titel} onChange={e => setTitel(e.target.value)} placeholder="Film of serienaam" required maxLength={160} />
            <select className="invoer" value={type} onChange={e => setType(e.target.value)}>
                <option value="film">Film</option><option value="serie">Serie</option>
            </select>
            <input className="invoer" inputMode="numeric" type="number" min="1900" max="2100" value={jaar} onChange={e => setJaar(e.target.value)} placeholder="Jaartal (optioneel)" />
            <button className="knop" disabled={bezig}>Toevoegen aan muziekwachtrij</button>
        </form>
        {melding && <p className="feedback neutraal">{melding}</p>}
    </section>;
}

export function CatalogusPerJaar() {
    const [status,setStatus]=useState(null);
    const [melding,setMelding]=useState('');
    const [fout,setFout]=useState('');
    const [tellingen,setTellingen]=useState([]);
    const [mp3Status,setMp3Status]=useState(null);
    async function laad() {
        try {const [d,t,m]=await Promise.all([haal('/api/admin/tmdb/catalogus/status'),haal('/api/admin/catalogus-tellingen'),haal('/api/admin/ontbrekende-lokale/status')]);setStatus(d);setTellingen(t.categorieen||[]);setMp3Status(m);setFout('');}
        catch(err){setFout(err.message);}
    }
    useEffect(()=>{laad();const timer=setInterval(laad,4000);return ()=>clearInterval(timer);},[]);
    async function opschonen() {
        if(!window.confirm('Alleen nog niet goedgekeurde, weinig bekende TMDB-titels zonder MP3 uitsluiten? Bestaande titels en MP3’s worden niet verwijderd.')) return;
        try {const d=await haal('/api/admin/catalogus/opschonen-bekend',{method:'POST'});setMelding(`${d.uitgesloten} weinig bekende titels uitgesloten. Geen titels of MP3’s verwijderd.`);await laad();}
        catch(err){setFout(err.message);}
    }
    async function start() {
        try {
            const r=await haal('/api/admin/tmdb/catalogus',{method:'POST',...jsonBody({})});
            setMelding(r.gestart?'Catalogusimport op de server gestart; je kunt deze pagina verlaten.':('Andere taak actief: '+(r.taak||'onbekend')));
            await laad();
        }catch(err){setFout(err.message);}
    }
    return <section className="kaart ai-kaart">
        <h3>Grote film- en seriecatalogus · per jaartal</h3>
        <p className="dim">TMDB haalt films en series op voor ieder jaar vanaf 1980 t/m het huidige jaar, met Nederlandse regio-context. Dit is een aparte catalogusimport: niet beperkt tot wat ChatGPT zelf kan bedenken. TMDB bevestigt niet dat elke serie daadwerkelijk op Nederlandse televisie is uitgezonden.</p>
        <p className="dim">Echte catalogus: {tellingen.map(t=>`${t.type}: ${t.titels} titels · ${t.met_mp3} met MP3 · ${t.te_beoordelen} te beoordelen`).join(' | ') || 'laden…'}. De kleine tellers bovenaan zijn uitsluitend AI-muziekaanbevelingen.</p>
        <div className="knoprij"><button className="knop knop-stil" onClick={opschonen}>Onbekende titels veilig opschonen</button><button className="knop" disabled={status?.bezig} onClick={start}>Catalogus 1980–nu ophalen</button><Link className="knop knop-stil" to="/admin">Ontbrekende MP3's: beheer</Link></div>
        {status && <p className="dim">{status.bezig?'Bezig':'Status: '+(status.klaar?'afgerond':'niet gestart')} · {status.fase||status.stap||'catalogus'} · {status.verwerkt||0}/{status.totaal||'—'} verwerkt · {status.nieuw||0} nieuw · {status.bestaand||0} bestaand</p>}
        {status?.fout && <p className="waarschuwing">{status.fout}</p>}
        {mp3Status && <p className="dim">Automatische MP3-aanvulling: {mp3Status.bezig ? 'bezig' : mp3Status.klaar ? 'laatste ronde afgerond' : 'wacht op ronde'} · {mp3Status.stap || 'wachten'} · {mp3Status.verwerkt || 0}/{mp3Status.totaal || '—'} verwerkt{mp3Status.fout ? ' · fout: '+mp3Status.fout : ''}. Controle elke 30 minuten, maximaal 25 zoekopdrachten per ronde.</p>}
        {melding && <p className="dim">{melding}</p>}
        {fout && <p className="waarschuwing">{fout}</p>}
    </section>;
}

export function Genereren() {
    const [bezig, setBezig] = useState(false);
    const [wachtrij, setWachtrij] = useState([]);
    const [wachtrijFout, setWachtrijFout] = useState('');
    async function verversWachtrij() {
        try {
            const d=await haal('/api/admin/aanbevelingen/wachtrij');
            setWachtrij(d.taken || []);
            setBezig((d.taken || []).some(t=>['wachtend','bezig'].includes(t.status)));
            setWachtrijFout('');
        } catch(err) {setWachtrijFout(err.message);}
    }
    useEffect(()=>{
        verversWachtrij();
        const t=setInterval(verversWachtrij,3500);
        return ()=>clearInterval(t);
    },[]);

    const [melding, setMelding] = useState('');
    const [aantallen, setAantallen] = useState({});
    const [perCategorie, setPerCategorie] = useState({});
    const [speelbaar,setSpeelbaar]=useState([]);
    const [categorie, setCategorie] = useState('film');
    const [aantal, setAantal] = useState(500);
    const [aantalGames,setAantalGames]=useState(0);
    const [gameTaken,setGameTaken]=useState([]);
    const categorieen = [['film', 'Films'], ['serie', 'Series'], ['games', 'Videogames'], ['disney', 'Disney'], ['kerst', 'Kerst'], ['rock', 'Rock'], ['80s', '80s'], ['90s', '90s'], ['20s', '20s (2020–2029)'], ['kinder', 'Kinder'], ['100nl', '100% NL']];
    const poll = useRef(null);

    async function ververs() {
        try {
            const s = await haal('/api/admin/aanbevelingen/status');
            setAantallen(s.aantallen || {});
            setPerCategorie(s.perCategorie || {});
            haal('/api/admin/aanbevelingen/speelbaar-telling').then(x=>setSpeelbaar(x.aantallen||[])).catch(()=>setSpeelbaar([]));
            haal('/api/admin/games').then(x=>setAantalGames(x.length)).catch(()=>{});
            haal('/api/admin/games/ai-status').then(x=>setGameTaken(x.taken||[])).catch(()=>{});
            if (s.run && !s.run.bezig) {
                clearInterval(poll.current);
                if (s.run.fout) setMelding(s.run.fout);
                else if (s.run.resultaat) setMelding(`Klaar: ${s.run.resultaat.toegevoegd} toegevoegd.`);
            }
        } catch { /* */ }
    }
    useEffect(() => { ververs(); const t=setInterval(ververs,4000); return () => {clearInterval(t);clearInterval(poll.current);}; }, []);

    async function start() {
        setBezig(true); setMelding('ChatGPT denkt na… dit kan even duren.');
        try {
            if(categorie==='games') {
                const r=await haal('/api/admin/games/ai-genereren',{method:'POST',...jsonBody({aantal:Number(aantal)})});
                setMelding('Videogames toegevoegd aan de achtergrondwachtrij: taak '+r.taak_id+' ('+r.aantal+' gevraagd).');
                await ververs();
                setBezig(false);
                return;
            }
            await haal('/api/admin/aanbevelingen/genereer', { method: 'POST', ...jsonBody({ categorie, soort: categorie === 'kerst' ? 'kerst' : 'film_serie', aantal: Number(aantal) }) });
            await verversWachtrij();
            clearInterval(poll.current);
            poll.current = setInterval(ververs, 3000);
        } catch (e) { setBezig(false); setMelding(e.message); }
    }

    async function vulVanuitDatabase() {
        setMelding('Bekende titels zonder MP3 uit de database naar Swipe plaatsen…');
        try {
            const r=await haal('/api/admin/aanbevelingen/catalogus-naar-swipe',{
                method:'POST',...jsonBody({categorie})});
            setMelding(r.ok ? (r.toegevoegd+' bekende '+categorie+'-titels aan Swipe toegevoegd.') : (r.error||'Geen nieuwe titels'));
            await ververs();
        }catch(err){setMelding('Catalogus naar Swipe mislukt: '+err.message);}
    }

    async function herzoek() {
        setMelding('ChatGPT zoekt de juiste nummers opnieuw…');
        try {
            await haal('/api/admin/aanbevelingen/herzoek', { method: 'POST' });
            clearInterval(poll.current);
            poll.current = setInterval(ververs, 3000);
        } catch (e) { setMelding(e.message); }
    }

    const fs = aantallen.film_serie || {};
    const k = aantallen.kerst || {};

    return (
        <section className="kaart ai-kaart">
            <p className="kaart-label">Aanbevelingen ophalen</p>
            <p className="dim ai-uitleg">
                Kies zelf hoeveel nieuwe nummers je per categorie wilt verzamelen. Daarna beoordeel je de fragmenten.
            </p>

            <div className="ai-knoprij" style={{ alignItems: 'end' }}>
                <label style={{ flex: '1 1 160px' }}>Categorie
                    <select className="invoer" value={categorie} onChange={(e) => setCategorie(e.target.value)} style={{ display: 'block', width: '100%' }}>
                        {categorieen.map(([waarde, naam]) => <option key={waarde} value={waarde}>{naam}</option>)}
                    </select>
                </label>
                <label style={{ flex: '1 1 120px' }}>Aantal nummers
                    <input className="invoer" type="number" min="1" max="10000" value={aantal}
                        onChange={(e) => setAantal(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </label>
                <button className="knop" disabled={!Number.isInteger(Number(aantal)) || Number(aantal) < 1 || Number(aantal) > 10000} onClick={start}>Lijst maken</button>
            </div>
            {['film','serie'].includes(categorie) && <button className="knop knop-stil" type="button" onClick={vulVanuitDatabase}>100 bekende {categorie === 'film' ? 'films' : 'series'} uit database naar Swipe</button>}
            <p className="dim">Aantal per aanvraag (videogames maximaal 500; verwerkt in batches van 20). Films en series zijn apart opgeslagen en kunnen later samen worden geselecteerd.</p>
            {categorie==='games' && <div className="vt-queue"><strong>Videogames AI-voortgang</strong>{!gameTaken.length && <p className="dim">Nog geen game-aanvragen.</p>}{gameTaken.map(t=><p key={t.id}>Taak {t.id} · {t.status} · {t.verwerkt}/{t.gevraagd} verwerkt · {t.toegevoegd} nieuw{t.fout ? ' · FOUT: '+t.fout : ''}</p>)}</div>}
            <div className="vt-queue"><strong>AI-wachtrij</strong>{wachtrijFout && <p className="waarschuwing">{wachtrijFout}</p>}{wachtrij.slice(0,10).map(t=><p key={t.id}>{t.categorie} · {t.status} · {t.verwerkt}/{t.gevraagd} verwerkt · {t.toegevoegd} toegevoegd{t.fout ? " · " + t.fout : ""}</p>)}</div>
        <div className="ai-tellers" style={{ marginTop: '0.75rem' }}>
                {categorieen.map(([waarde, naam]) =>
                    <Teller key={waarde} label={naam} n={waarde==='games'?aantalGames:(perCategorie[waarde]?.totaal || 0)} />)}
            </div>

            {melding && <p className={bezig ? 'dim' : 'feedback neutraal'} style={{ marginTop: '1rem' }}>{melding}</p>}

            <div className="ai-tellers">
                <Teller label="Blind te swipen · MP3 klaar" n={speelbaar.filter(x=>x.status==='nieuw').reduce((n,x)=>n+x.aantal,0)} />
                <Teller label="Met naam · MP3 klaar" n={speelbaar.filter(x=>x.status==='blind_nee').reduce((n,x)=>n+x.aantal,0)} />
                <Teller label="Goedgekeurd" n={(fs.goed || 0) + (k.goed || 0) + (fs.toegevoegd || 0) + (k.toegevoegd || 0)} />
            </div>
            <div className="ai-tellers" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: '0.5rem' }}>
                <Teller label="Fout (AI opnieuw)" n={(fs.fout || 0) + (k.fout || 0)} />
                <Teller label="Bij anderen (review)" n={(fs.review || 0) + (k.review || 0)} />
            </div>

            <div className="ai-knoprij" style={{ marginTop: '1rem' }}>
                {((fs.nieuw || 0) + (k.nieuw || 0) + (fs.blind_nee || 0) + (k.blind_nee || 0)) > 0 && (
                    <Link className="knop" to="/admin/swipe">Swipen →</Link>
                )}
                {((fs.fout || 0) + (k.fout || 0)) > 0 && (
                    <button className="knop knop-stil" onClick={herzoek} disabled={bezig}>
                        Foute opnieuw zoeken
                    </button>
                )}
            </div>

            {((fs.review || 0) + (k.review || 0)) > 0 && <ReviewLink aantal={(fs.review || 0) + (k.review || 0)} />}
        </section>
    );
}

function Teller({ label, n }) {
    return (
        <div className="tegel">
            <span className="tegel-waarde">{n}</span>
            <span className="tegel-label">{label}</span>
        </div>
    );
}

function ReviewLink({ aantal }) {
    const [gekopieerd, setGekopieerd] = useState(false);
    const url = (typeof window !== 'undefined' ? window.location.origin : '') + '/review';
    async function kopieer() {
        try { await navigator.clipboard.writeText(url); setGekopieerd(true); setTimeout(() => setGekopieerd(false), 2000); }
        catch { /* selecteerbaar in beeld */ }
    }
    return (
        <div className="kaart" style={{ marginTop: '1rem' }}>
            <p className="kaart-label">Review-link delen</p>
            <p className="dim ai-uitleg">
                {aantal} nummer{aantal === 1 ? '' : 's'} wacht op anderen. Deel deze link; vrienden
                luisteren blind en stemmen of ze het kennen.
            </p>
            <div className="ai-knoprij">
                <input className="invoer" readOnly value={url} onFocus={(e) => e.target.select()} />
                <button className="knop" onClick={kopieer}>{gekopieerd ? 'Gekopieerd!' : 'Kopieer'}</button>
            </div>
        </div>
    );
}
