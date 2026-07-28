// =====================================================================
// Minimale service worker voor VenTune (PWA).
//
// BELANGRIJK: de service worker mag audio/video niet onderscheppen. iOS
// Safari eist voor media een 206-range-antwoord; een service worker die
// dat niet teruggeeft laat elke clip mislukken. Daarom handelen we alleen
// same-origin, niet-media, niet-API GET-verzoeken af. Cross-origin
// (iTunes-previews, YouTube) en range-verzoeken laten we volledig met rust.
// =====================================================================

// Ophogen bij elke wijziging hier: oude caches worden bij 'activate'
// weggegooid. v3 ruimt de MP3's op die v2 ten onrechte had opgeslagen.
const CACHE = 'ventune-v3';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((sleutels) =>
                Promise.all(
                    sleutels.filter((s) => s !== CACHE).map((s) => caches.delete(s)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Alleen onze eigen origin afhandelen. iTunes-audio en YouTube nooit.
    if (url.origin !== self.location.origin) return;

    // API en sockets nooit cachen/onderscheppen.
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
        return;
    }

    // Media nooit onderscheppen. Niet alleen range-verzoeken: het éérste
    // verzoek van een <audio>-element heeft vaak nog geen Range-header, en
    // een uit de cache geserveerd 200-antwoord kan niet gescrubd worden.
    // De speler bleef dan op "bezig" staan zonder ooit geluid te geven.
    if (req.headers.has('range')) return;
    if (req.destination === 'audio' || req.destination === 'video') return;
    if (url.pathname.startsWith('/media/')) return;

    // Navigatie: netwerk eerst, cache als terugval (offline).
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req)
                .then((resp) => {
                    const kopie = resp.clone();
                    caches.open(CACHE).then((c) => c.put('/', kopie));
                    return resp;
                })
                .catch(() => caches.match('/')),
        );
        return;
    }

    // Statische assets (js/css/fonts/afbeeldingen): cache-first.
    e.respondWith(
        caches.match(req).then(
            (gecached) =>
                gecached ||
                fetch(req).then((resp) => {
                    // Alleen nette, volledige antwoorden cachen.
                    if (resp && resp.status === 200 && resp.type === 'basic') {
                        const kopie = resp.clone();
                        caches.open(CACHE).then((c) => c.put(req, kopie));
                    }
                    return resp;
                }),
        ),
    );
});
