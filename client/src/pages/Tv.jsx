import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { audioBron } from '../lib/api.js';
import Timer from '../components/Timer.jsx';
import { Tegels, AntwoordKaart } from '../components/Speelbord.jsx';

// TV / beamer: alleen kijken en de lokale MP3 afspelen.
// Spelers antwoorden op hun eigen telefoon of tablet; dit scherm heeft geen
// sessietoken en geen recht om het spel te bedienen.
export default function Tv() {
    const { code: paramCode } = useParams();
    const code = String(paramCode || '').toUpperCase();
    const [fase, setFase] = useState('verbinden');
    const [melding, setMelding] = useState('');
    const [ronde, setRonde] = useState(null);
    const [antwoord, setAntwoord] = useState(null);
    const [deelnemers, setDeelnemers] = useState([]);
    const [scorebord, setScorebord] = useState([]);
    const [audio, setAudio] = useState(null);
    const [audioStarten, setAudioStarten] = useState(false);
    const [geluidAan, setGeluidAan] = useState(false);
    const [bonus, setBonus] = useState(null);
    const [pauze, setPauze] = useState(false);
    const speler = useRef(null);
    const geluidAanRef = useRef(false);
    const joinUrl = useMemo(() => `${window.location.origin}/join/${code}`, [code]);

    useEffect(() => {
        const socket = io({ reconnection: true });
        const verbind = () => {
            setMelding('');
            socket.emit('tv:kijken', { code });
        };
        socket.on('connect', verbind);
        socket.on('disconnect', () => setMelding('Verbinding verbroken — opnieuw verbinden…'));
        socket.on('tv:welkom', (data) => {
            setFase(data.status === 'wachten' ? 'wachten' : 'raden');
            setMelding('');
        });
        socket.on('tv:fout', (f) => setMelding(f?.melding || 'Verbinding mislukt.'));
        socket.on('lobby:spelers', (lijst) => setDeelnemers(Array.isArray(lijst) ? lijst : []));
        socket.on('ronde:start', (data) => {
            setRonde({ ...data, startTs: data?.startTs || Date.now() });
            setMelding('');
            setBonus(null);
            setPauze(false);
            setAntwoord(null);
            setAudio(null);
            setAudioStarten(false);
            setFase('raden');
        });
        socket.on('ronde:audio', (data) => {
            if (data?.url) {
                setAudio(data);
                setAudioStarten(false);
                setFase('raden');
            }
        });
        socket.on('ronde:audio-pauze', () => speler.current?.pause());
        socket.on('ronde:audio-hervat', () => {
            if (geluidAanRef.current) speler.current?.play().catch(() => setAudioStarten(true));
        });
        socket.on('ronde:pauze', (v) => {
            setPauze(!!v?.gepauzeerd);
            if (v?.gepauzeerd) speler.current?.pause();
            if (!v?.gepauzeerd && v?.restMs) setRonde((r) => (r ? { ...r, startTs: Date.now(), durationMs: v.restMs } : r));
        });
        socket.on('ronde:bonus', (v) => { setBonus(v || null); setFase('bonus'); });
        socket.on('ronde:onthul', (v) => {
            setAntwoord(v?.antwoord || null);
            setFase('onthul');
            speler.current?.pause();
        });
        socket.on('ronde:afgelopen', (v) => { setScorebord(v?.scorebord || []); setFase('scorebord'); });
        socket.on('spel:scores', (v) => { if (Array.isArray(v)) setScorebord(v); });
        socket.on('spel:einde', (v) => { setScorebord(v?.scorebord || []); setFase('einde'); speler.current?.pause(); });
        socket.on('spel:voorbereiden', (v) => setMelding(v?.melding || 'Tracks voorbereiden…'));
        socket.on('spel:fout', (v) => setMelding(v?.melding || 'Er is een fout opgetreden.'));
        return () => socket.disconnect();
    }, [code]);

    useEffect(() => {
        const el = speler.current;
        if (!el || !audio?.url || fase !== 'raden') return undefined;
        el.pause();
        el.src = audioBron(audio.url);
        el.load();
        const positie = () => {
            if (Number(audio.startSeconde) > 0) {
                try { el.currentTime = Number(audio.startSeconde); } catch { /* MP3 zonder seek */ }
            }
        };
        el.addEventListener('loadedmetadata', positie);
        if (geluidAanRef.current && !audio.pauze) {
            el.play().then(() => setAudioStarten(false)).catch(() => setAudioStarten(true));
        } else {
            setAudioStarten(true);
        }
        return () => { el.removeEventListener('loadedmetadata', positie); };
    }, [audio, fase]);

    async function speel() {
        const el = speler.current;
        geluidAanRef.current = true;
        setGeluidAan(true);
        if (!el || !audio?.url) return;
        try {
            await el.play();
            setAudioStarten(false);
            setMelding('');
        } catch {
            setAudioStarten(true);
            setMelding('Selecteer Afspelen op de afstandsbediening om audio toe te staan.');
        }
    }

    function volledigScherm() {
        const fn = document.documentElement.requestFullscreen;
        if (fn) Promise.resolve(fn.call(document.documentElement)).catch(() => {});
    }

    const opties = ronde?.opties || null;
    const juistIndex = antwoord && opties ? opties.findIndex((o) => o === antwoord.naam) : -1;

    return (
        <main className="kz kz-tv">
            <audio ref={speler} preload="metadata" className="kz-verborgen" aria-label="Muziek van de huidige ronde" />
            <header className="kz-kop">
                <span className="kz-teller">{fase === 'raden' || fase === 'onthul'
                    ? <>Vraag {ronde?.rondenummer || '—'}<small>/{ronde?.totaal || '∞'}</small></>
                    : fase === 'bonus' ? <>Bonus<small> +50</small></>
                    : fase === 'scorebord' ? <>Na vraag {ronde?.rondenummer || ''}<small>/{ronde?.totaal || '∞'}</small></> : 'VenTune'}</span>
                <span className="kz-kop-midden">
                    {fase === 'raden' && ronde?.durationMs && !pauze ? <span className="kz-klok"><Timer startTs={ronde.startTs} durationMs={ronde.durationMs} /></span> : null}
                </span>
                <span className="kz-rij">
                    <b className="kz-code">{code}</b>
                    <button type="button" className="kz-icoon" onClick={volledigScherm} aria-label="Volledig scherm">⛶</button>
                </span>
            </header>
            {melding && <div className="kz-balk-melding" role="status"><span>{melding}</span></div>}
            {fase === 'verbinden' && <section className="kz-melding-groot"><strong>Verbinden…</strong></section>}
            {fase === 'wachten' && (
                <section className="kz-tv-lobby">
                    <div className="kz-qr"><QRCodeSVG value={joinUrl} bgColor="#ffffff" fgColor="#111111" size={260} includeMargin /></div>
                    <div>
                        <p className="kz-label">Doe mee op je telefoon</p>
                        <h1 className="kz-code-groot">{code}</h1>
                        <p className="kz-sub">{window.location.host}</p>
                        <div className="kz-spelers">{deelnemers.map((s) => <span key={s.id} className="kz-speler">{s.naam}{s.team_naam ? <small>{s.team_naam}</small> : null}</span>)}</div>
                    </div>
                </section>
            )}
            {(fase === 'raden' || fase === 'onthul') && (
                <>
                    <section className="kz-vraag">
                        <h1>{fase === 'onthul' && antwoord ? antwoord.naam : (ronde?.vraag || 'Herken je deze muziek?')}</h1>
                        {fase === 'onthul' && antwoord && <p className="kz-sub">{[antwoord.tracknaam, antwoord.artiest, antwoord.jaar].filter(Boolean).join(' · ')}</p>}
                    </section>
                    <section className="kz-antwoorden">
                        {opties ? <Tegels opties={opties} onKies={() => {}} vergrendeld juist={juistIndex >= 0 ? juistIndex : null}
                            uit={fase === 'onthul' && juistIndex >= 0 ? opties.map((_, i) => i).filter((i) => i !== juistIndex) : []} />
                            : <div className="kz-melding-groot"><strong>Typ je antwoord op je telefoon</strong></div>}
                    </section>
                    {fase === 'raden' && (audioStarten || !geluidAan) && (
                        <footer className="kz-voet"><span className="kz-sub">Geluid via deze tv?</span>
                            <button className="knop" type="button" onClick={speel}>▶ Geluid aan</button></footer>
                    )}
                </>
            )}
            {fase === 'bonus' && bonus && (
                <>
                    <section className="kz-vraag"><h1>{bonus.vraag}</h1></section>
                    <section className="kz-antwoorden"><Tegels opties={bonus.opties} onKies={() => {}} vergrendeld /></section>
                </>
            )}
            {(fase === 'scorebord' || fase === 'einde') && (
                <section className="kz-score">
                    {antwoord && fase === 'scorebord' && <AntwoordKaart antwoord={antwoord} />}
                    <h2>{fase === 'einde' ? 'Eindstand' : 'Tussenstand'}</h2>
                    <ol className={'kz-stand' + (fase === 'einde' ? ' eind' : '')}>{scorebord.slice(0, 8).map((s, i) => (
                        <li key={s.id || i} className={fase === 'einde' && i < 3 ? `plek-${i + 1}` : ''}>
                            <span className="kz-plek">{i + 1}</span><span className="kz-naam">{s.naam}</span><span className="kz-punten">{Number(s.score || 0)}</span>
                        </li>
                    ))}</ol>
                </section>
            )}
            {pauze && fase === 'raden' && <div className="kz-pauze"><span>Pauze</span></div>}
        </main>
    );
}
