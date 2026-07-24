import React, { useEffect, useRef, useState, useCallback } from 'react';
import Visualizer from './Visualizer.jsx';
import { maakSpeler } from '../lib/youtube.js';
import { audioBron } from '../lib/api.js';

// Speelt de muziek af op het host-scherm en toont de visualizer.
// - YouTube: via de IFrame-speler, volledig afgedekt zodat de titel
//   nooit zichtbaar is.
// - iTunes/lokaal: via een <audio>-element (iTunes loopt via onze proxy).
//
// Browsers (vooral iOS Safari) blokkeren geluid dat niet direct uit een
// tik voortkomt. Lukt automatisch starten niet, dan tonen we een grote
// "Tik om te starten"-knop — die werkt altijd.
export default function HostPlayer({ audio }) {
    const audioRef = useRef(null);
    const ytMountRef = useRef(null);
    const ytSpelerRef = useRef(null);
    const [moetTikken, setMoetTikken] = useState(false);

    const isYoutube = !!audio && audio.bron === 'youtube';

    // Maak de YouTube-speler alvast aan zodra het host-scherm laadt, zodat
    // hij klaarstaat wanneer de ronde begint.
    useEffect(() => {
        let afgebroken = false;
        (async () => {
            if (!ytMountRef.current || ytSpelerRef.current) return;
            try {
                const speler = await maakSpeler(ytMountRef.current);
                if (!afgebroken) ytSpelerRef.current = speler;
            } catch {
                /* API niet beschikbaar; audio-bronnen werken nog wel. */
            }
        })();
        return () => {
            afgebroken = true;
        };
    }, []);

    // Start het afspelen (of probeer het opnieuw na een tik).
    const start = useCallback(
        async (naTik) => {
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
                // Controleer even later of hij echt speelt (1 = PLAYING).
                setTimeout(() => {
                    try {
                        const staat = speler.getPlayerState && speler.getPlayerState();
                        setMoetTikken(staat !== 1);
                    } catch {
                        setMoetTikken(true);
                    }
                }, 1200);
                return;
            }

            // iTunes of lokaal bestand.
            const el = audioRef.current;
            if (!el) return;
            if (!naTik) {
                el.src = audioBron(audio.url);
                el.currentTime = audio.startSeconde || 0;
            }
            try {
                await el.play();
                setMoetTikken(false);
            } catch {
                setMoetTikken(true);
            }
        },
        [audio],
    );

    useEffect(() => {
        // Geen opdracht meer: alles stoppen.
        if (!audio) {
            setMoetTikken(false);
            if (audioRef.current) audioRef.current.pause();
            const speler = ytSpelerRef.current;
            if (speler && speler.stopVideo) {
                try {
                    speler.stopVideo();
                } catch {
                    /* negeren */
                }
            }
            return;
        }
        setMoetTikken(false);
        start(false);
    }, [audio, start]);

    return (
        <div className="host-speler">
            {/* YouTube-mount: altijd afgedekt zodat de titel nooit te zien is. */}
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
                        start(true);
                    }}
                >
                    ▶ Tik om de muziek te starten
                </button>
            )}

            <audio ref={audioRef} preload="none" playsInline />
        </div>
    );
}
