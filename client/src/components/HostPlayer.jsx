import React, { useEffect, useRef } from 'react';
import Visualizer from './Visualizer.jsx';
import { maakSpeler } from '../lib/youtube.js';

// Speelt de muziek af op het host-scherm en toont de visualizer.
// - iTunes/lokaal: via een verborgen <audio>.
// - YouTube: via de IFrame-speler, afgedekt door een zwarte laag + de
//   visualizer, zodat de titel niet zichtbaar is.
export default function HostPlayer({ audio }) {
    const audioRef = useRef(null);
    const ytMountRef = useRef(null);
    const ytSpelerRef = useRef(null);

    useEffect(() => {
        const audioEl = audioRef.current;

        // Geen opdracht → alles stoppen.
        if (!audio) {
            if (audioEl) audioEl.pause();
            if (ytSpelerRef.current && ytSpelerRef.current.stopVideo) {
                try { ytSpelerRef.current.stopVideo(); } catch { /* negeren */ }
            }
            return;
        }

        if (audio.bron === 'youtube') {
            // Zorg dat de speler bestaat en start de video.
            (async () => {
                if (!ytSpelerRef.current && ytMountRef.current) {
                    ytSpelerRef.current = await maakSpeler(ytMountRef.current);
                }
                const speler = ytSpelerRef.current;
                if (speler && speler.loadVideoById) {
                    speler.loadVideoById({
                        videoId: audio.url,
                        startSeconds: audio.startSeconde || 0,
                    });
                    speler.playVideo();
                }
            })();
            if (audioEl) audioEl.pause();
        } else {
            // iTunes of lokaal: gewone audio.
            if (audioEl) {
                audioEl.src = audio.url;
                audioEl.currentTime = audio.startSeconde || 0;
                audioEl.play().catch(() => {});
            }
            if (ytSpelerRef.current && ytSpelerRef.current.stopVideo) {
                try { ytSpelerRef.current.stopVideo(); } catch { /* negeren */ }
            }
        }
    }, [audio]);

    const isYoutube = audio && audio.bron === 'youtube';

    return (
        <div className="host-speler">
            {/* YouTube-mount (alleen zichtbaar-gemaakt als er YT speelt, maar
                altijd afgedekt). */}
            <div className={'yt-laag' + (isYoutube ? ' actief' : '')}>
                <div ref={ytMountRef} className="yt-mount" />
                <div className="yt-cover" />
            </div>

            {/* De visualizer staat er altijd bovenop. */}
            <div className="host-speler-visual">
                <Visualizer actief />
            </div>

            <audio ref={audioRef} preload="none" />
        </div>
    );
}
