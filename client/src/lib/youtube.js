// =====================================================================
// YouTube IFrame-API loader. Laadt de API één keer (alleen op het
// host-scherm, en alleen als er een YouTube-track speelt) en maakt een
// speler aan. De video wordt op het host-scherm afgedekt met de
// visualizer, zodat niemand de titel ziet.
// =====================================================================

let apiKlaar = null;

function laadApi() {
    if (apiKlaar) return apiKlaar;
    apiKlaar = new Promise((resolve) => {
        if (window.YT && window.YT.Player) return resolve(window.YT);
        const vorige = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (vorige) vorige();
            resolve(window.YT);
        };
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
    });
    return apiKlaar;
}

/** Maak een YouTube-speler in het gegeven element. */
export async function maakSpeler(element) {
    const YT = await laadApi();
    return new Promise((resolve) => {
        const speler = new YT.Player(element, {
            height: '100%',
            width: '100%',
            playerVars: {
                autoplay: 0,
                controls: 0,
                disablekb: 1,
                modestbranding: 1,
                rel: 0,
                fs: 0,
                iv_load_policy: 3,
            },
            events: { onReady: () => resolve(speler) },
        });
    });
}

/** Haal een YouTube-video-id uit een URL of losse id. */
export function haalVideoId(invoer) {
    if (!invoer) return '';
    const s = String(invoer).trim();
    // youtu.be/ID
    let m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    // youtube.com/watch?v=ID
    m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    // youtube.com/embed/ID
    m = s.match(/embed\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    // Al een kaal id
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return s;
}
