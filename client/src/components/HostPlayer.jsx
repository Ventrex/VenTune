import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from 'react';
import Visualizer from './Visualizer.jsx';
import { maakSpeler } from '../lib/youtube.js';
import { audioBron } from '../lib/api.js';

function wacht(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function metTimeout(belofte, ms, melding) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(melding)), ms);
    });
    return Promise.race([belofte, timeout]).finally(() => clearTimeout(timer));
}

/** Wacht totdat de browser metadata heeft en start daarna pas de audio. */
async function laadEnSpeelAudio(element, url, startSeconde, isActief) {
    element.pause();
    element.src = audioBron(url);
    element.load();

    if (element.readyState < 1) {
        await new Promise((resolve, reject) => {
            let klaar = false;
            const timeout = setTimeout(() => fout(), 10000);
            const opruimen = () => {
                element.removeEventListener('loadedmetadata', metadata);
                element.removeEventListener('error', fout);
                clearTimeout(timeout);
            };
            const metadata = () => {
                if (klaar) return;
                klaar = true;
                opruimen();
                resolve();
            };
            const fout = () => {
                if (klaar) return;
                klaar = true;
                opruimen();
                reject(new Error('Audio kon niet worden geladen.'));
            };
            element.addEventListener('loadedmetadata', metadata);
            element.addEventListener('error', fout);
            if (element.readyState >= 1) metadata();
        });
    }
    if (!isActief()) return false;
    element.currentTime = Number(startSeconde) || 0;
    await metTimeout(
        element.play(),
        10000,
        'Audio starten duurt te lang.',
    );
    return true;
}

// Speelt de muziek af op het host-scherm en toont de visualizer.
// - YouTube: via de IFrame-speler, volledig afgedekt zodat de titel
//   nooit zichtbaar is.
// - iTunes/lokaal: via een <audio>-element (iTunes loopt via onze proxy).
//
// Browsers (vooral iOS Safari) staan geluid alleen toe direct na een tik.
// Daarom wordt de speler bij de "Start spel"-tik eenmalig ontgrendeld
// (ontgrendel()); daarna mag hij ook in latere rondes vanzelf spelen.
// Lukt het toch niet, dan verschijnt een grote "Tik om te starten"-knop.
const HostPlayer = forwardRef(function HostPlayer({ audio, verborgen = false }, ref) {
    const audioRef = useRef(null);
    const ytMountRef = useRef(null);
    const ytSpelerRef = useRef(null);
    const ytSpelerPromiseRef = useRef(null);
    const ontgrendeldRef = useRef(false);
    const speelTokenRef = useRef(0);
    const [moetTikken, setMoetTikken] = useState(false);

    const isYoutube = !!audio && audio.bron === 'youtube';

    // Gebruik één gedeelde promise. Zonder deze wachtrij konden het
    // voorbereidende effect en de eerste ronde tegelijk twee YouTube-players
    // in hetzelfde element maken; dan ging de eerste ronde soms stil voorbij.
    const haalYtSpeler = useCallback(async () => {
        if (ytSpelerRef.current) return ytSpelerRef.current;
        if (!ytMountRef.current) throw new Error('YouTube-element ontbreekt.');
        if (!ytSpelerPromiseRef.current) {
            ytSpelerPromiseRef.current = metTimeout(
                maakSpeler(ytMountRef.current),
                10000,
                'YouTube-speler reageert niet.',
            )
                .then((speler) => {
                    ytSpelerRef.current = speler;
                    return speler;
                })
                .catch((err) => {
                    ytSpelerPromiseRef.current = null;
                    throw err;
                });
        }
        return ytSpelerPromiseRef.current;
    }, []);

    // Speler alvast klaarzetten zodra het host-scherm laadt.
    useEffect(() => {
        haalYtSpeler().catch(() => {
            /* zonder YouTube-track is dit geen fout */
        });
    }, [haalYtSpeler]);

    // Wordt aangeroepen vanuit de tik op "Start spel": geeft de browser het
    // signaal dat afspelen door de gebruiker is gestart.
    const ontgrendel = useCallback(async () => {
        ontgrendeldRef.current = true;
        // Audio-element ontgrendelen met een korte stille play.
        const el = audioRef.current;
        if (el) {
            try {
                el.muted = true;
                await el.play();
                el.pause();
                el.currentTime = 0;
                el.muted = false;
            } catch {
                /* niet fataal */
            }
        }
        // YouTube-speler ontgrendelen.
        const speler = await haalYtSpeler().catch(() => null);
        if (speler && speler.playVideo) {
            try {
                speler.mute();
                speler.playVideo();
                setTimeout(() => {
                    try {
                        speler.pauseVideo();
                        speler.unMute();
                    } catch {
                        /* negeren */
                    }
                }, 60);
            } catch {
                /* niet fataal */
            }
        }
    }, [haalYtSpeler]);

    useImperativeHandle(ref, () => ({ ontgrendel }), [ontgrendel]);

    // Start (of herstart) het afspelen van de huidige opdracht.
    const start = useCallback(async (token = ++speelTokenRef.current) => {
        if (!audio) return;
        const isActief = () => speelTokenRef.current === token;

        if (audio.bron === 'youtube') {
            let speler;
            try {
                speler = await metTimeout(
                    haalYtSpeler(),
                    10000,
                    'YouTube laden duurt te lang.',
                );
            } catch {
                if (isActief()) setMoetTikken(true);
                return;
            }
            if (!isActief()) return;
            if (!speler || !speler.loadVideoById) {
                setMoetTikken(true);
                return;
            }
            try {
                speler.loadVideoById({
                    videoId: audio.url,
                    startSeconds: audio.startSeconde || 0,
                });
                speler.unMute();
                if (speler.setVolume) speler.setVolume(100);
                speler.playVideo();
            } catch {
                if (isActief()) setMoetTikken(true);
                return;
            }
            // Controleer meerdere keren: loadVideoById is asynchroon en kan
            // tijdens de eerste poging nog -1 (unstarted) teruggeven.
            for (let poging = 0; poging < 10; poging++) {
                await wacht(350);
                if (!isActief()) return;
                try {
                    const staat = speler.getPlayerState && speler.getPlayerState();
                    if (staat === 1 || staat === 3) {
                        setMoetTikken(false);
                        return;
                    }
                    speler.playVideo();
                } catch {
                    /* volgende poging probeert opnieuw */
                }
            }
            if (isActief()) setMoetTikken(true);
            return;
        }

        // iTunes of lokaal bestand. Een lokale download hoort niet opnieuw
        // afhankelijk te zijn van YouTube; probeer een korte race opnieuw
        // wanneer de browser de eerste lokale play-call te vroeg afwijst.
        const el = audioRef.current;
        if (!el) return;
        let laatsteFout = null;
        for (let poging = 0; poging < 3; poging++) {
            try {
                await laadEnSpeelAudio(el, audio.url, audio.startSeconde, isActief);
                if (isActief()) setMoetTikken(false);
                return;
            } catch (err) {
                laatsteFout = err;
                if (!isActief()) return;
                await wacht(250 * (poging + 1));
            }
        }
        if (isActief()) {
            // Alleen autoplay blokkade of een echte disk/netwerkfout mag de
            // handmatige startknop tonen; de korte retries zijn dan op.
            setMoetTikken(true);
            console.warn('Lokale audio kon niet starten.', laatsteFout);
        }
    }, [audio, haalYtSpeler]);

    useEffect(() => {
        const token = ++speelTokenRef.current;
        if (!audio) {
            setMoetTikken(false);
            if (audioRef.current) audioRef.current.pause();
            const speler = ytSpelerRef.current;
            if (speler && speler.pauseVideo) {
                try {
                    // Pauzeren in plaats van stoppen: de speler blijft
                    // ontgrendeld voor de volgende ronde.
                    speler.pauseVideo();
                } catch {
                    /* negeren */
                }
            }
            return;
        }

        // Host heeft gepauzeerd: alleen stilzetten, niet opnieuw laden.
        if (audio.pauze) {
            if (audioRef.current) audioRef.current.pause();
            const speler = ytSpelerRef.current;
            if (speler && speler.pauseVideo) {
                try {
                    speler.pauseVideo();
                } catch {
                    /* negeren */
                }
            }
            return;
        }

        // Hervatten na pauze: doorgaan waar we waren.
        if (audio.hervat) {
            if (audioRef.current && audioRef.current.src) {
                audioRef.current.play().catch(() => setMoetTikken(true));
            }
            const speler = ytSpelerRef.current;
            if (speler && speler.playVideo) {
                try {
                    speler.playVideo();
                } catch {
                    /* negeren */
                }
            } else {
                start(token);
            }
            return;
        }

        setMoetTikken(false);
        start(token);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audio, start]);

    return (
        <div className={'host-speler' + (verborgen ? ' host-speler-verborgen' : '')}>
            <div className={'yt-laag' + (isYoutube ? ' actief' : '')}>
                <div ref={ytMountRef} className="yt-mount" />
                <div className="yt-cover" />
            </div>

            <div className="host-speler-visual">
                <Visualizer actief={!moetTikken} />
            </div>

            {moetTikken && (
                <button
                    className="tik-start"
                    onClick={() => {
                        setMoetTikken(false);
                        ontgrendeldRef.current = true;
                        start();
                    }}
                >
                    ▶ Tik om de muziek te starten
                </button>
            )}

            <audio ref={audioRef} preload="auto" playsInline />
        </div>
    );
});

export default HostPlayer;
