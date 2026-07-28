// =====================================================================
// Zoek uit hóé het nummer heet dat bij een film of serie hoort.
//
// Dit is bewust alleen een OPZOEKER van metadata, geen audiobron. Het
// spel speelt uitsluitend lokale MP3's; wat hier gevonden wordt, maakt de
// YouTube-zoekopdracht gericht in plaats van gokwerk.
//
// Aanpak in twee stappen, in plaats van botweg "<titel> soundtrack"
// zoeken en hopen op het beste:
//
//   1. Zoek het SOUNDTRACK-ALBUM in de iTunes-catalogus. Heet dat album
//      naar de titel ("100% Coco (Original Soundtrack)"), dan hoort élk
//      nummer erop bij die titel. Daarmee is de koppeling vrijwel zeker
//      juist. Uit de tracklijst kiezen we het meest herkenbare nummer
//      (titelsong of main theme).
//   2. Lukt dat niet, dan kan Wikipedia de naam van de titelsong geven
//      ("De titelsong is ... van ..."), waarna we die naam gebruiken.
//
// Alles gratis en zonder API-key.
// =====================================================================

const logger = require('./logger');
const cache = require('./cache');
const { pastBijTitel, normaliseer } = require('./trackcheck');

const ITUNES_ZOEK = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const LAND = process.env.ITUNES_LAND || 'NL';

const UA = { 'User-Agent': 'VenTune/1.0 (self-hosted quiz)' };

async function haalJson(url) {
    const resp = await fetch(url, { headers: UA });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    return resp.json();
}

// ---------------------------------------------------------------------
// Stap 1: het soundtrack-album vinden
// ---------------------------------------------------------------------

/**
 * Zoek albums die bij deze titel horen. Een album telt alleen mee als de
 * naam van de titel erin voorkomt — dat is precies de garantie die we
 * willen.
 *
 * @returns {Promise<Array<{collectionId, album, artiest, jaar, aantal}>>}
 */
async function zoekAlbums(titel) {
    const termen = [
        `${titel.naam} soundtrack`,
        `${titel.naam} original soundtrack`,
        titel.naam,
    ];

    const gevonden = new Map();
    for (const term of termen) {
        let items;
        const uitCache = await cache.lees('itunes-album', term);
        if (uitCache) {
            items = uitCache;
        } else {
            const params = new URLSearchParams({
                term,
                media: 'music',
                entity: 'album',
                limit: '15',
                country: LAND,
            });
            try {
                const data = await haalJson(`${ITUNES_ZOEK}?${params.toString()}`);
                items = (data.results || []).map((r) => ({
                    collectionId: r.collectionId,
                    album: r.collectionName,
                    artiest: r.artistName,
                    jaar: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
                    aantal: r.trackCount || 0,
                }));
                await cache.schrijf('itunes-album', term, items);
            } catch (err) {
                logger.waarschuwing('Album zoeken mislukt.', {
                    term,
                    melding: err.message,
                });
                continue;
            }
        }

        for (const a of items) {
            // De albumnaam moet de titel bevatten, anders is het niet van
            // deze film of serie.
            if (!pastBijTitel(titel, { album: a.album }).past) continue;
            if (!gevonden.has(a.collectionId)) gevonden.set(a.collectionId, a);
        }
        if (gevonden.size > 0) break; // eerste bruikbare zoekterm is genoeg
    }

    return [...gevonden.values()];
}

/** Haal alle nummers van een album op (met preview-clips). */
async function haalAlbumNummers(collectionId) {
    const sleutel = `album:${collectionId}`;
    const uitCache = await cache.lees('itunes-tracks', sleutel);
    if (uitCache) return uitCache;

    const params = new URLSearchParams({
        id: String(collectionId),
        entity: 'song',
        limit: '100',
        country: LAND,
    });
    const data = await haalJson(`${ITUNES_LOOKUP}?${params.toString()}`);
    const nummers = (data.results || [])
        .filter((r) => r.wrapperType === 'track' && r.previewUrl)
        .map((r) => ({
            itunes_track_id: r.trackId,
            tracknaam: r.trackName,
            artiest: r.artistName,
            album: r.collectionName,
            preview_url: r.previewUrl,
            nummer: r.trackNumber || 0,
            jaar: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
        }));
    if (nummers.length > 0) {
        await cache.schrijf('itunes-tracks', sleutel, nummers);
    }
    return nummers;
}

// Woorden die op de herkenbare titelsong/thema wijzen.
const STERK = [
    'main title', 'main theme', 'title theme', 'opening', 'intro',
    'titelsong', 'titelmuziek', 'theme from', 'end title',
];
// Woorden die op achtergrondmuziek wijzen (minder herkenbaar).
const ZWAK = [
    'score', 'suite', 'reprise', 'instrumental', 'alternate', 'demo',
    'orchestral', 'underscore',
];

/**
 * Kies uit de albumnummers het meest herkenbare. Puur en testbaar.
 */
function kiesUitAlbum(nummers, titel) {
    if (!nummers || nummers.length === 0) return null;
    const naamNorm = normaliseer(titel.naam);

    let beste = null;
    let besteScore = -Infinity;

    nummers.forEach((n) => {
        const t = normaliseer(n.tracknaam);
        let score = 0;

        // Een nummer dat naar de titel is genoemd is bijna altijd het thema.
        if (naamNorm && t.includes(naamNorm)) score += 6;
        if (STERK.some((w) => t.includes(w))) score += 5;
        if (ZWAK.some((w) => t.includes(w))) score -= 2;

        // Het eerste nummer op een soundtrack is vaak de titelsong.
        if (n.nummer === 1) score += 2;
        else if (n.nummer > 0 && n.nummer <= 3) score += 1;

        if (score > besteScore) {
            besteScore = score;
            beste = n;
        }
    });

    return beste;
}

/**
 * Zoek via het soundtrack-album het juiste nummer voor deze titel.
 * @returns {Promise<object|null>} een iTunes-nummer, of null
 */
async function viaAlbum(titel) {
    const albums = await zoekAlbums(titel);
    if (albums.length === 0) return null;

    // Album dat qua jaar het best past, anders het eerste.
    albums.sort((a, b) => {
        if (!titel.jaar) return (b.aantal || 0) - (a.aantal || 0);
        const da = a.jaar ? Math.abs(a.jaar - titel.jaar) : 99;
        const db = b.jaar ? Math.abs(b.jaar - titel.jaar) : 99;
        return da - db;
    });

    for (const album of albums.slice(0, 3)) {
        try {
            const nummers = await haalAlbumNummers(album.collectionId);
            const keuze = kiesUitAlbum(nummers, titel);
            if (keuze) {
                return { ...keuze, albumnaam: album.album, via: 'album' };
            }
        } catch (err) {
            logger.waarschuwing('Albumnummers ophalen mislukt.', {
                album: album.album,
                melding: err.message,
            });
        }
    }
    return null;
}

// ---------------------------------------------------------------------
// Stap 2 (aanvulling): de naam van de titelsong via Wikipedia
// ---------------------------------------------------------------------

// Patronen waarmee Wikipedia een titelsong beschrijft.
//
// Let op de aanhalingstekens: alleen dubbele (recht én krul) gelden als
// begrenzing. Een enkele apostrof komt namelijk gewoon ín songtitels voor
// ("I'll Be There for You"), dus die mag de match niet afbreken.
const SONG_PATRONEN = [
    /titelsong[^.]{0,40}?["“]([^"”]{2,60})["”]/i,
    /titelnummer[^.]{0,40}?["“]([^"”]{2,60})["”]/i,
    /titelmuziek[^.]{0,40}?["“]([^"”]{2,60})["”]/i,
    /theme song[^.]{0,40}?(?:is|titled|called|was)\s*["“]([^"”]{2,60})["”]/i,
    /title song[^.]{0,40}?(?:is|titled|called|was)\s*["“]([^"”]{2,60})["”]/i,
    /main theme[^.]{0,40}?(?:is|titled|called|was)\s*["“]([^"”]{2,60})["”]/i,
    /["“]([^"”]{2,60})["”][^.]{0,30}\bis de titelsong/i,
    /["“]([^"”]{2,60})["”][^.]{0,30}\bis the theme song/i,
];

/**
 * Zoek op Wikipedia hoe de titelsong heet. Geeft de songnaam of null.
 * Gratis, geen key. Probeert de Nederlandse en Engelse Wikipedia.
 */
async function songNaamViaWikipedia(titel) {
    const sleutel = `wiki:${titel.naam}`;
    const uitCache = await cache.lees('wikipedia', sleutel);
    if (uitCache) return uitCache.songnaam || null;

    const talen = titel.taal === 'nl' ? ['nl', 'en'] : ['en', 'nl'];
    for (const taal of talen) {
        const params = new URLSearchParams({
            action: 'query',
            prop: 'extracts',
            explaintext: '1',
            redirects: '1',
            format: 'json',
            titles: titel.naam,
        });
        try {
            const data = await haalJson(
                `https://${taal}.wikipedia.org/w/api.php?${params.toString()}`,
            );
            const paginas = (data.query && data.query.pages) || {};
            for (const key of Object.keys(paginas)) {
                const tekst = paginas[key].extract;
                if (!tekst) continue;
                for (const patroon of SONG_PATRONEN) {
                    const m = tekst.match(patroon);
                    if (m && m[1]) {
                        const songnaam = m[1].trim();
                        await cache.schrijf('wikipedia', sleutel, { songnaam });
                        return songnaam;
                    }
                }
            }
        } catch (err) {
            logger.waarschuwing('Wikipedia niet bereikbaar.', {
                melding: err.message,
            });
        }
    }
    await cache.schrijf('wikipedia', sleutel, { songnaam: null });
    return null;
}

/**
 * Zoek een specifiek nummer op iTunes (bijvoorbeeld de titelsong die
 * Wikipedia noemde) en controleer of het bij de titel past.
 */
async function zoekSpecifiekNummer(songnaam, titel) {
    const term = `${songnaam} ${titel.naam}`;
    const uitCache = await cache.lees('itunes', term);
    let nummers = uitCache;
    if (!nummers) {
        const params = new URLSearchParams({
            term,
            media: 'music',
            entity: 'song',
            limit: '10',
            country: LAND,
        });
        try {
            const data = await haalJson(`${ITUNES_ZOEK}?${params.toString()}`);
            nummers = (data.results || [])
                .filter((r) => r.previewUrl)
                .map((r) => ({
                    itunes_track_id: r.trackId,
                    tracknaam: r.trackName,
                    artiest: r.artistName,
                    album: r.collectionName,
                    preview_url: r.previewUrl,
                    jaar: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
                }));
            await cache.schrijf('itunes', term, nummers);
        } catch {
            return null;
        }
    }

    const songNorm = normaliseer(songnaam);
    // De tracknaam moet de gevonden songnaam bevatten, én het geheel moet
    // bij de titel passen (album of naam).
    for (const n of nummers) {
        if (!normaliseer(n.tracknaam).includes(songNorm)) continue;
        if (pastBijTitel(titel, n).past) {
            return { ...n, via: 'wikipedia' };
        }
    }
    // Songnaam klopt maar album verwijst niet naar de titel: dan alleen
    // gebruiken als de songnaam heel specifiek is (meerdere woorden).
    if (songNorm.split(' ').length >= 2) {
        for (const n of nummers) {
            if (normaliseer(n.tracknaam) === songNorm) {
                return { ...n, via: 'wikipedia-song', onzeker: true };
            }
        }
    }
    return null;
}

/**
 * Hoofdingang: zoek het juiste nummer voor een titel.
 *
 * Volgorde: soundtrack-album (zekerst) → titelsong via Wikipedia.
 * Geeft null als er niets betrouwbaars is; dan valt de import terug op de
 * gewone YouTube-zoekopdracht.
 */
async function zoekVoorTitel(titel) {
    try {
        const uitAlbum = await viaAlbum(titel);
        if (uitAlbum) return uitAlbum;
    } catch (err) {
        logger.waarschuwing('Album-route mislukt.', { melding: err.message });
    }

    try {
        const songnaam = await songNaamViaWikipedia(titel);
        if (songnaam) {
            const nummer = await zoekSpecifiekNummer(songnaam, titel);
            if (nummer) return { ...nummer, songnaam };
            // Songnaam gevonden maar geen clip: geef hem terug zodat de
            // YouTube-zoekopdracht er gericht op kan zoeken.
            return { alleenSongnaam: songnaam };
        }
    } catch (err) {
        logger.waarschuwing('Wikipedia-route mislukt.', { melding: err.message });
    }

    return null;
}

module.exports = {
    zoekVoorTitel,
    viaAlbum,
    zoekAlbums,
    haalAlbumNummers,
    kiesUitAlbum,
    songNaamViaWikipedia,
    zoekSpecifiekNummer,
    SONG_PATRONEN,
};
