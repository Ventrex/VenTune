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
    const [lobbyInstellingen, setLobbyInstellingen] = useState({});
    const [teams, setTeams] = useState([]);
    const [fase, setFase] = useState('wachten'); // wachten|raden|onthul|bonus|scorebord|einde
    const [ronde, setRonde] = useState(null); // {rondenummer, totaal, durationMs, startTs}
    const [antwoordOpties, setAntwoordOpties] = useState(null);
    const [verwijderdeOpties, setVerwijderdeOpties] = useState([]);
    const [hulplijnen, setHulplijnen] = useState({ verwijder3: null });
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
    const [herstelNodig, setHerstelNodig] = useState(false);
    const [herstelBezig, setHerstelBezig] = useState(false);
    // Afspeel-opdracht voor de host: { bron, url, startSeconde }. Spelers
    // krijgen dit niet en horen dus niets.
    const [audio, setAudio] = useState(null);

    useEffect(() => {
        if (!sessie?.token) return;
        const socket = haalSocket();

        const hallo = () => {
            setVerbonden(true);
            setHerstelNodig(false);
            socket.emit('lobby:hallo', { token: sessie.token });
        };
        const bijSpelers = (lijst) => setSpelers(lijst);
        const bijWelkom = (d) => {
            setLobbyInstellingen(d.instellingen || {});
            setTeams(d.teams || d.instellingen?.teams || []);
        };
        const bijInstellingen = (d) => {
            setLobbyInstellingen(d.instellingen || {});
            setTeams(d.teams || d.instellingen?.teams || []);
        };
        const bijFout = ({ melding } = {}) => {
            setFout(melding || 'Er ging iets mis.');
            if (melding?.includes('opnieuw') || melding?.includes('herstel')) {
                setHerstelNodig(true);
            }
        };
        const bijVoorbereiden = ({ melding }) => setFout(melding || 'Muziek voorbereiden...');
        const bijVerbroken = () => {
            setVerbonden(false);
            setHerstelNodig(true);
            setHerstelBezig(false);
        };

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
            setAntwoordOpties(d.opties || null);
            setVerwijderdeOpties([]);
            setRonde({ ...d, startTs: d.startTs || Date.now() });
            setAudio(null);
            setFase('raden');
            setHerstelNodig(false);
            setHerstelBezig(false);
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
        const bijVerwijder3 = (d) => {
            if (d.fout) setResultaat({ status: 'hint-fout', melding: d.fout });
            else {
                setVerwijderdeOpties(d.indexen || []);
                setHulplijnen((h) => ({ ...h, verwijder3: d.voorraad }));
            }
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
            setHerstelBezig(false);
        };
        const bijScores = (sb) => setScorebord(sb);
        const bijEinde = ({ scorebord: sb }) => {
            setAudio(null);
            setScorebord(sb);
            setFase('einde');
            setHerstelNodig(false);
            setHerstelBezig(false);
        };
        const bijHerstelNodig = () => setHerstelNodig(true);

        socket.on('connect', hallo);
        socket.on('disconnect', bijVerbroken);
        socket.on('lobby:spelers', bijSpelers);
        socket.on('lobby:welkom', bijWelkom);
        socket.on('lobby:instellingen', bijInstellingen);
        socket.on('lobby:fout', bijFout);
        socket.on('spel:fout', bijFout);
        socket.on('spel:voorbereiden', bijVoorbereiden);
        socket.on('ronde:start', bijStart);
        socket.on('ronde:audio', bijAudio);
        socket.on('ronde:resultaat', bijResultaat);
        socket.on('ronde:gewonnen', bijGewonnen);
        socket.on('ronde:pauze', bijPauze);
        socket.on('ronde:melding-ok', bijMeldingOk);
        socket.on('ronde:audio-pauze', bijAudioPauze);
        socket.on('ronde:audio-hervat', bijAudioHervat);
        socket.on('ronde:hint', bijHint);
        socket.on('ronde:verwijder3', bijVerwijder3);
        socket.on('ronde:onthul', bijOnthul);
        socket.on('ronde:bonus', bijBonus);
        socket.on('ronde:bonus-resultaat', bijBonusResultaat);
        socket.on('ronde:afgelopen', bijAfgelopen);
        socket.on('spel:scores', bijScores);
        socket.on('spel:einde', bijEinde);
        socket.on('spel:herstel-nodig', bijHerstelNodig);

        if (socket.connected) hallo();

        return () => {
            socket.off('connect', hallo);
            socket.off('disconnect', bijVerbroken);
            socket.off('lobby:spelers', bijSpelers);
            socket.off('lobby:welkom', bijWelkom);
            socket.off('lobby:instellingen', bijInstellingen);
            socket.off('lobby:fout', bijFout);
            socket.off('spel:fout', bijFout);
            socket.off('spel:voorbereiden', bijVoorbereiden);
            socket.off('ronde:start', bijStart);
            socket.off('ronde:audio', bijAudio);
            socket.off('ronde:resultaat', bijResultaat);
            socket.off('ronde:gewonnen', bijGewonnen);
            socket.off('ronde:pauze', bijPauze);
            socket.off('ronde:melding-ok', bijMeldingOk);
            socket.off('ronde:audio-pauze', bijAudioPauze);
            socket.off('ronde:audio-hervat', bijAudioHervat);
            socket.off('ronde:hint', bijHint);
            socket.off('ronde:verwijder3', bijVerwijder3);
            socket.off('ronde:onthul', bijOnthul);
            socket.off('ronde:bonus', bijBonus);
            socket.off('ronde:bonus-resultaat', bijBonusResultaat);
            socket.off('ronde:afgelopen', bijAfgelopen);
            socket.off('spel:scores', bijScores);
            socket.off('spel:einde', bijEinde);
            socket.off('spel:herstel-nodig', bijHerstelNodig);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessie?.token, isHost]);

    // Als het scorebord langer blijft staan dan de normale overgang, laat
    // een herstelactie zien. De server kan daarna dezelfde overgang opnieuw
    // plannen zonder de sessie of de spelers kwijt te raken.
    useEffect(() => {
        if (fase !== 'scorebord') return undefined;
        const timer = setTimeout(() => setHerstelNodig(true), 12000);
        return () => clearTimeout(timer);
    }, [fase, ronde?.rondeId]);

    const startSpel = useCallback(() => haalSocket().emit('spel:start'), []);
    const wijzigTeam = useCallback((teamNaam) => haalSocket().emit('lobby:team', { teamNaam }), []);
    const bewaarLobbyInstellingen = useCallback((instellingen) => {
        haalSocket().emit('lobby:instellingen', { instellingen });
    }, []);
    const gok = useCallback((tekst) => haalSocket().emit('ronde:gok', { gok: tekst }), []);
    const vraagHint = useCallback(() => haalSocket().emit('ronde:hint'), []);
    const verwijder3 = useCallback(() => haalSocket().emit('ronde:verwijder3'), []);
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
    const herstelSpel = useCallback(() => {
        const socket = haalSocket();
        setHerstelBezig(true);
        setFout('');

        const naVerbinding = () => {
            socket.emit('spel:herstel');
            setHerstelBezig(false);
        };

        if (socket.connected) {
            naVerbinding();
            return;
        }

        socket.once('connect', naVerbinding);
        socket.connect();
        // Laat de knop niet eindeloos als bezig staan wanneer de verbinding
        // zelf niet lukt; de bestaande sessie blijft wel bewaard.
        setTimeout(() => setHerstelBezig(false), 5000);
    }, []);

    return {
        sessie,
        isHost,
        verbonden,
        spelers,
        lobbyInstellingen,
        teams,
        fase,
        ronde,
        antwoordOpties,
        verwijderdeOpties,
        hulplijnen,
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
        herstelNodig,
        herstelBezig,
        startSpel,
        wijzigTeam,
        bewaarLobbyInstellingen,
        volgende,
        herhaal,
        pauzeer,
        hervat,
        meldFout,
        gok,
        vraagHint,
        verwijder3,
        bonusAntwoord,
        herstelSpel,
    };
}
