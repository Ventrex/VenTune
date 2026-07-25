// =====================================================================
// useSpel: gedeelde React-hook die de socket opzet en de volledige
// spelstate bijhoudt. Zowel het Host- als het Play-scherm gebruikt hem.
//
// De host speelt de audio af (in de kamer) en kan op hetzelfde scherm
// meespelen; andere spelers horen niets op hun telefoon en zien alleen de
// visualizer — geen titel tot de ronde klaar is.
// =====================================================================

import { useEffect, useState, useCallback } from 'react';
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
    const [winnaarId, setWinnaarId] = useState(null);
    const [gepauzeerd, setGepauzeerd] = useState(false);
    const [melded, setMelded] = useState(false);
    const [fout, setFout] = useState('');
    // Afspeel-opdracht voor de host: { bron, url, startSeconde }. Spelers
    // krijgen dit niet en horen dus niets.
    const [audio, setAudio] = useState(null);

    useEffect(() => {
        if (!sessie?.token) return;
        const socket = haalSocket();

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
            setWinnaarId(null);
            setGepauzeerd(false);
            setMelded(false);
            setRonde({ ...d, startTs: Date.now() });
            setAudio(null);
            setFase('raden');
        };
        const bijAudio = (d) => {
            // Alleen de host krijgt en speelt de audio af.
            if (isHost) setAudio(d);
        };
        const bijResultaat = (r) => setResultaat(r);
        const bijGewonnen = ({ spelerId }) => setWinnaarId(spelerId);
        const bijPauze = (d) => {
            setGepauzeerd(!!d.gepauzeerd);
            // Na hervatten loopt de klok verder vanaf nu.
            if (!d.gepauzeerd && d.restMs) {
                setRonde((r) =>
                    r ? { ...r, startTs: Date.now(), durationMs: d.restMs } : r,
                );
            }
        };
        const bijMeldingOk = () => setMelded(true);
        const bijAudioPauze = () => setAudio((a) => (a ? { ...a, pauze: true } : a));
        const bijAudioHervat = () =>
            setAudio((a) => (a ? { ...a, pauze: false, hervat: Date.now() } : a));
        const bijHint = (h) => {
            if (h.fout) setResultaat({ status: 'hint-fout', melding: h.fout });
            else setHints((lijst) => [...lijst, h]);
        };
        const bijOnthul = ({ antwoord: a }) => {
            setAudio(null); // Muziek stoppen bij de host.
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
            setAudio(null);
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
        socket.on('ronde:gewonnen', bijGewonnen);
        socket.on('ronde:pauze', bijPauze);
        socket.on('ronde:melding-ok', bijMeldingOk);
        socket.on('ronde:audio-pauze', bijAudioPauze);
        socket.on('ronde:audio-hervat', bijAudioHervat);
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
            socket.off('ronde:gewonnen', bijGewonnen);
            socket.off('ronde:pauze', bijPauze);
            socket.off('ronde:melding-ok', bijMeldingOk);
            socket.off('ronde:audio-pauze', bijAudioPauze);
            socket.off('ronde:audio-hervat', bijAudioHervat);
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
    const volgende = useCallback(() => haalSocket().emit('ronde:volgende'), []);
    const herhaal = useCallback(() => haalSocket().emit('ronde:herhaal'), []);
    const pauzeer = useCallback(() => haalSocket().emit('ronde:pauzeer'), []);
    const hervat = useCallback(() => haalSocket().emit('ronde:hervat'), []);
    const meldFout = useCallback(
        (soort = 'fout', toelichting = null) =>
            haalSocket().emit('ronde:melden', { soort, toelichting }),
        [],
    );
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
        audio,
        winnaarId,
        gepauzeerd,
        melded,
        fout,
        startSpel,
        volgende,
        herhaal,
        pauzeer,
        hervat,
        meldFout,
        gok,
        vraagHint,
        bonusAntwoord,
    };
}
