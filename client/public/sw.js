// =====================================================================
// Minimale service worker voor VenTune (PWA).
// Navigatie: network-first (altijd de nieuwste app), met cache als
// terugval bij offline. Statische assets: cache-first.
// =====================================================================

const CACHE = 'ventune-v1';

self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((sleutels) =>
            Promise.all(sleutels.filter((s) => s !== CACHE).map((s) => caches.delete(s))),
        ),
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // API en sockets nooit cachen.
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
        return;
    }

    // Navigatie: probeer het netwerk, val terug op de cache.
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

    // Overige GET's: cache-first.
    e.respondWith(
        caches.match(req).then(
            (gecached) =>
                gecached ||
                fetch(req).then((resp) => {
                    const kopie = resp.clone();
                    caches.open(CACHE).then((c) => c.put(req, kopie));
                    return resp;
                }),
        ),
    );
});
