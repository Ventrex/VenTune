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

// Speelt de muziek af op het host-scherm en toont de visualizer.
// - YouTube: via de IFrame-speler, volledig afgedekt zodat de titel
//   nooit zichtbaar is.
// - iTunes/lokaal: via een <audio>-element (iTunes loopt via onze proxy).
//
// Browsers (vooral iOS Safari) staan geluid alleen toe direct na een tik.
// Daarom wordt de speler bij de "Start spel"-tik eenmalig ontgrendeld
// (ontgrendel()); daarna mag hij ook in latere rondes vanzelf spelen.
// Lukt het toch niet, dan verschijnt een grote "Tik om te starten"-knop.
const HostPlayer = forwardRef(function HostPlayer({ audio }, ref) {
    const audioRef = useRef(null);
    const ytMountRef = useRef(null);
    const ytSpelerRef = useRef(null);
    const ontgrendeldRef = useRef(false);
    const [moetTikken, setMoetTikken] = useState(false);

    const isYoutube = !!audio && audio.bron === 'youtube';

    // Speler alvast klaarzetten zodra het host-scherm laadt.
    useEffect(() => {
        let weg = false;
        (async () => {
            if (!ytMountRef.current || ytSpelerRef.current) return;
            try {
                const speler = await maakSpeler(ytMountRef.current);
                if (!weg) ytSpelerRef.current = speler;
            } catch {
                /* zonder YT-API werken audio-bronnen nog steeds */
            }
        })();
        return () => {
            weg = true;
        };
    }, []);

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
        const speler = ytSpelerRef.current;
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
    }, []);

    useImperativeHandle(ref, () => ({ ontgrendel }), [ontgrendel]);

    // Start (of herstart) het afspelen van de huidige opdracht.
    const start = useCallback(async () => {
        if (!audio) return;

        if (audio.bron === 'youtube') {
            let speler = ytSpelerRef.current;
            if (!speler && ytMountRef.current) {
                try {
                    speler = await maakSpeler(ytMountRef.current);
                    ytSpelerRef.current = speler;
                } catch {
                    setMoetTikken(true);
                    return;
                }
            }
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
                speler.setVolume(100);
                speler.playVideo();
            } catch {
                setMoetTikken(true);
                return;
            }
            // Controleer of hij echt speelt (1 = PLAYING, 3 = bufferen).
            setTimeout(() => {
                try {
                    const staat = speler.getPlayerState && speler.getPlayerState();
                    setMoetTikken(!(staat === 1 || staat === 3));
                } catch {
                    setMoetTikken(true);
                }
            }, 1500);
            return;
        }

        // iTunes of lokaal bestand.
        const el = audioRef.current;
        if (!el) return;
        el.src = audioBron(audio.url);
        el.currentTime = audio.startSeconde || 0;
        try {
            await el.play();
            setMoetTikken(false);
        } catch {
            setMoetTikken(true);
        }
    }, [audio]);

    useEffect(() => {
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
        setMoetTikken(false);
        start();
    }, [audio, start]);

    return (
        <div className="host-speler">
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

            <audio ref={audioRef} preload="none" playsInline />
        </div>
    );
});

export default HostPlayer;
