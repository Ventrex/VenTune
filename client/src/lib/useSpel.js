// =====================================================================
// useSpel: gedeelde React-hook die de socket opzet en de volledige
// spelstate bijhoudt. Zowel het Host- als het Play-scherm gebruikt hem.
//
// De host speelt de audio af (in de kamer); spelers horen niets op hun
// telefoon en zien alleen de visualizer — geen titel tot de ronde klaar is.
// =====================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { haalSocket } from './socket.js';
import { leesSessie } from './sessie.js';

export function useSpel() {
    const sessie = leesSessie();
    const isHost = !!sessie?.is_host;

    const [verbonden, setVerbonden] = useState(false);
    const [spelers, setSpelers] = useState([]);
    const [fase, setFase] = useState('wachten'); // wachten|raden|onthul|bonus|scorebord|einde
    const [ronde, setRonde] = useState(null); // {rondenummer, totaal, durationMs, startTs}
    const [resultaat, setResultaat] = useState(null); // laatste gok-uitslag
    const [hints, setHints] = useState([]); // ontvangen hints deze ronde
    const [antwoord, setAntwoord] = useState(null); // onthuld na de ronde
    const [bonus, setBonus] = useState(null); // {vraag, opties, durationMs}
    const [bonusResultaat, setBonusResultaat] = useState(null);
    const [scorebord, setScorebord] = useState([]);
    const [fout, setFout] = useState('');

    const audioRef = useRef(null);

    useEffect(() => {
        if (!sessie?.token) return;
        const socket = haalSocket();
        if (!audioRef.current) audioRef.current = new Audio();

        const hallo = () => {
            setVerbonden(true);
            socket.emit('lobby:hallo', { token: sessie.token });
        };
        const bijSpelers = (lijst) => setSpelers(lijst);
        const bijFout = ({ melding }) => setFout(melding);
        const bijVerbroken = () => setVerbonden(false);

        const bijStart = (d) => {
            setFout('');
            setResultaat(null);
            setHints([]);
            setAntwoord(null);
            setBonus(null);
            setBonusResultaat(null);
            setRonde({ ...d, startTs: Date.now() });
            setFase('raden');
        };
        const bijAudio = (d) => {
            // Alleen de host speelt de audio af.
            if (!isHost || !audioRef.current) return;
            audioRef.current.src = d.previewUrl;
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => {});
        };
        const bijResultaat = (r) => setResultaat(r);
        const bijHint = (h) => {
            if (h.fout) setResultaat({ status: 'hint-fout', melding: h.fout });
            else setHints((lijst) => [...lijst, h]);
        };
        const bijOnthul = ({ antwoord: a }) => {
            if (audioRef.current) audioRef.current.pause();
            setAntwoord(a);
            setFase('onthul');
        };
        const bijBonus = (d) => {
            setBonusResultaat(null);
            setBonus(d);
            setFase('bonus');
        };
        const bijBonusResultaat = (r) => setBonusResultaat(r);
        const bijAfgelopen = ({ scorebord: sb }) => {
            setScorebord(sb);
            setFase('scorebord');
        };
        const bijScores = (sb) => setScorebord(sb);
        const bijEinde = ({ scorebord: sb }) => {
            if (audioRef.current) audioRef.current.pause();
            setScorebord(sb);
            setFase('einde');
        };

        socket.on('connect', hallo);
        socket.on('disconnect', bijVerbroken);
        socket.on('lobby:spelers', bijSpelers);
        socket.on('lobby:fout', bijFout);
        socket.on('spel:fout', bijFout);
        socket.on('ronde:start', bijStart);
        socket.on('ronde:audio', bijAudio);
        socket.on('ronde:resultaat', bijResultaat);
        socket.on('ronde:hint', bijHint);
        socket.on('ronde:onthul', bijOnthul);
        socket.on('ronde:bonus', bijBonus);
        socket.on('ronde:bonus-resultaat', bijBonusResultaat);
        socket.on('ronde:afgelopen', bijAfgelopen);
        socket.on('spel:scores', bijScores);
        socket.on('spel:einde', bijEinde);

        if (socket.connected) hallo();

        return () => {
            socket.off('connect', hallo);
            socket.off('disconnect', bijVerbroken);
            socket.off('lobby:spelers', bijSpelers);
            socket.off('lobby:fout', bijFout);
            socket.off('spel:fout', bijFout);
            socket.off('ronde:start', bijStart);
            socket.off('ronde:audio', bijAudio);
            socket.off('ronde:resultaat', bijResultaat);
            socket.off('ronde:hint', bijHint);
            socket.off('ronde:onthul', bijOnthul);
            socket.off('ronde:bonus', bijBonus);
            socket.off('ronde:bonus-resultaat', bijBonusResultaat);
            socket.off('ronde:afgelopen', bijAfgelopen);
            socket.off('spel:scores', bijScores);
            socket.off('spel:einde', bijEinde);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessie?.token, isHost]);

    const startSpel = useCallback(() => haalSocket().emit('spel:start'), []);
    const gok = useCallback((tekst) => haalSocket().emit('ronde:gok', { gok: tekst }), []);
    const vraagHint = useCallback(() => haalSocket().emit('ronde:hint'), []);
    const bonusAntwoord = useCallback(
        (keuze) => haalSocket().emit('ronde:bonus-antwoord', { keuze }),
        [],
    );

    return {
        sessie,
        isHost,
        verbonden,
        spelers,
        fase,
        ronde,
        resultaat,
        hints,
        antwoord,
        bonus,
        bonusResultaat,
        scorebord,
        fout,
        startSpel,
        gok,
        vraagHint,
        bonusAntwoord,
    };
}
