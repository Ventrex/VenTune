import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { audioBron } from '../lib/api.js';
import './tv.css';

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
            setRonde(data);
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
        socket.on('ronde:pauze', (v) => { if (v?.gepauzeerd) speler.current?.pause(); });
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

    return (
        <main className="vt-tv-scherm">
            <header className="vt-tv-header">
                <strong>VenTune <span>✦</span></strong>
                <div className="vt-tv-top-acties">
                    <span>Lobby {code}</span>
                    <button type="button" onClick={volledigScherm}>Volledig scherm</button>
                </div>
            </header>
            <audio ref={speler} preload="metadata" controls className="vt-tv-audio" aria-label="Muziek van de huidige ronde" />
            {melding && <p className="vt-tv-melding" role="status">{melding}</p>}
            {fase === 'verbinden' && <section className="vt-tv-midden"><h1>Verbinden met VenTune…</h1></section>}
            {fase === 'wachten' && (
                <section className="vt-tv-lobby">
                    <div>
                        <p className="vt-tv-eyebrow">Zet je telefoon klaar</p>
                        <h1>Speel samen op je eigen scherm</h1>
                        <p>Scan de QR-code met je mobiel of iPad en doe mee. De host start het spel.</p>
                        <p className="vt-tv-code">{code}</p>
                    </div>
                    <div className="vt-tv-qr"><QRCodeSVG value={joinUrl} bgColor="#ffffff" fgColor="#111026" size={210} includeMargin /></div>
                    <div className="vt-tv-spelers">
                        <h2>Spelers ({deelnemers.length})</h2>
                        <div>{deelnemers.map((s) => <span key={s.id}>{s.naam}</span>)}</div>
                    </div>
                </section>
            )}
            {fase === 'raden' && (
                <section className="vt-tv-midden" aria-live="polite">
                    <p className="vt-tv-eyebrow">Ronde {ronde?.rondenummer || '—'} / {ronde?.totaal || '—'}</p>
                    <h1>Welk nummer herken jij?</h1>
                    <div className="vt-tv-visualizer" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/></div>
                    <p>Raad mee op je telefoon of iPad.</p>
                    {(audioStarten || !geluidAan) && <button className="vt-tv-start" type="button" onClick={speel}>
                        <span aria-hidden="true">▶</span> Geluid starten op deze tv
                    </button>}
                </section>
            )}
            {(fase === 'onthul' || fase === 'scorebord') && (
                <section className="vt-tv-midden">
                    <p className="vt-tv-eyebrow">Het antwoord</p>
                    <h1>{antwoord?.naam || 'Ronde afgelopen'}</h1>
                    {antwoord && <p>{[antwoord.tracknaam, antwoord.artiest, antwoord.jaar].filter(Boolean).join(' · ')}</p>}
                </section>
            )}
            {(fase === 'scorebord' || fase === 'einde') && (
                <section className="vt-tv-score"><h2>{fase === 'einde' ? 'Eindstand' : 'Scorebord'}</h2>
                    <ol>{scorebord.slice(0, 10).map((s, i) => (
                        <li key={s.id || i}><strong>{s.naam}</strong><span>{Number(s.score || 0)} punten</span></li>
                    ))}</ol>
                </section>
            )}
            <footer>TV-scherm · alleen kijken · antwoorden en besturing staan op de apparaten van de spelers en de host</footer>
        </main>
    );
}
