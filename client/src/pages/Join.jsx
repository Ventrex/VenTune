import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { checkLobby, joinLobby, authSessie } from '../lib/api.js';
import { bewaarSessie } from '../lib/sessie.js';

// Joinpagina (/join/:code). Bereikt via QR-scan of code intypen.
// Controleert de lobby, vraagt een naam, en laat je meedoen.
export default function Join() {
    const { code } = useParams();
    const navigate = useNavigate();
    const bovenCode = (code || '').toUpperCase();

    const [status, setStatus] = useState('controleren'); // controleren | ok | weg
    const [naam, setNaam] = useState('');
    const [specialiteit, setSpecialiteit] = useState('');
    const [bezig, setBezig] = useState(false);
    const [fout, setFout] = useState('');
    const [account,setAccount]=useState(null);
    useEffect(()=>{
        authSessie().then(d=>{
            setAccount(d.ingelogd?d.gebruiker:null);
            if(d.ingelogd && d.gebruiker?.display_naam)setNaam(d.gebruiker.display_naam);
        }).catch(()=>setAccount(null));
    },[]);


    useEffect(() => {
        checkLobby(bovenCode)
            .then((info) => {
                if (info.bestaat && info.kan_joinen) setStatus('ok');
                else if (info.bestaat) {
                    setStatus('weg');
                    setFout('Dit spel is al begonnen.');
                } else {
                    setStatus('weg');
                    setFout('Deze lobby bestaat niet (meer).');
                }
            })
            .catch(() => {
                setStatus('weg');
                setFout('Kon de lobby niet controleren.');
            });
    }, [bovenCode]);

    async function meedoen(e) {
        e.preventDefault();
        if (!naam.trim()) {
            setFout('Vul een naam in.');
            return;
        }
        setBezig(true);
        setFout('');
        try {
            const res = await joinLobby(bovenCode, naam.trim(), null, specialiteit);
            bewaarSessie({
                token: res.token,
                code: res.code,
                spelerId: res.spelerId,
                is_host: false,
            });
            navigate('/play');
        } catch (err) {
            setFout(err.message);
            setBezig(false);
        }
    }

    return (
        <main className="scherm">
            <h1>Meedoen</h1>
            <p className="ondertitel">
                Lobby <span className="code-inline">{bovenCode}</span>
            </p>

            {fout && <p className="waarschuwing">{fout}</p>}

            {status === 'controleren' && <p className="dim">Lobby controleren…</p>}

            {status === 'ok' && (
                <>
                <div className="kaart" style={{marginBottom:10,padding:12}}>
                    {account ? <p>Je doet mee als <strong>{account.display_naam}</strong>.</p>
                        : <div className="stapel" style={{gap:7}}>
                            <p>Meedoen zonder account, of inloggen om scores aan je profiel te koppelen.</p>
                            <Link className="knop knop-stil" to={'/host/login?return='+encodeURIComponent('/join/'+bovenCode)}>Inloggen / account maken</Link>
                        </div>}
                </div>
                <form onSubmit={meedoen} className="stapel">
                    <input
                        className="invoer"
                        value={naam}
                        onChange={(e) => setNaam(e.target.value)}
                        placeholder="Je naam"
                        maxLength={24}
                        aria-label="Je naam"
                        autoFocus
                        readOnly={Boolean(account)}
                    />
                    <label className="dim">Jouw specialiteit (optioneel)
                        <select className="invoer" value={specialiteit} onChange={(e) => setSpecialiteit(e.target.value)}>
                            <option value="">Geen voorkeur</option>
                            {[['film','Films'],['serie','Series'],['disney','Disney'],['kerst','Kerst'],['rock','Rock'],['80s','80s'],['90s','90s'],['20s','20s'],['kinder','Kinder'],['100nl','100% NL']].map(([k,n]) => <option key={k} value={k}>{n}</option>)}
                        </select>
                    </label>
                    <button className="knop" type="submit" disabled={bezig}>
                        {bezig ? 'Meedoen…' : 'Meedoen'}
                    </button>
                </form>
                </>
            )}

            {status === 'weg' && (
                <p style={{ marginTop: '1.5rem' }}>
                    <Link className="terug" to="/">
                        ← Terug naar start
                    </Link>
                </p>
            )}
        </main>
    );
}
