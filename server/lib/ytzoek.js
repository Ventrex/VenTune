// =====================================================================
// YouTube-zoeken zonder API-key.
//
// Waarom: iTunes heeft nauwelijks film-/serie-thema's (en vrijwel geen
// Nederlandse), waardoor de vragenbank handmatig nagelopen moest worden.
// YouTube heeft praktisch elke intro en titelsong. We halen de
// zoekresultaten server-side op en lezen de video-id's uit de
// ytInitialData-payload die YouTube in de HTML meestuurt.
//
// Optioneel: staat YOUTUBE_API_KEY ingesteld, dan gebruiken we de
// officiële Data API (stabieler, maar met dagquota).
// =====================================================================

const logger = require('./logger');

const ZOEK_URL = 'https://www.youtube.com/results';
const API_URL = 'https://www.googleapis.com/youtube/v3/search';

// Video's korter dan dit zijn meestal fragmenten/shorts zonder muziek.
const MIN_SECONDEN = 20;
// Boven dit is het vaak een volledige aflevering of urenlange compilatie.
const MAX_SECONDEN = 45 * 60;

/**
 * Zet een weergaveteller om naar een getal. Vangt zowel Nederlandse als
 * Engelse notatie: "1.234.567 weergaven", "1,2 mln. weergaven", "1.2M
 * views", "123K views".
 */
function viewsNaarGetal(tekst) {
    if (!tekst) return null;
    const s = String(tekst).toLowerCase().replace(/ /g, ' ');
    const m = s.match(
        // Getal hebzuchtig pakken (zodat "1.234.567" heel blijft), daarna een
        // optioneel achtervoegsel dat niet in een ander woord mag doorlopen.
        /([0-9][0-9.,\s]*[0-9]|[0-9])\s*(mrd|miljard|mln|miljoen|duizend|[kmb])?(?![a-z])/,
    );
    if (!m) return null;

    const ruw = m[1].trim();
    const achtervoegsel = m[2];

    let factor = 1;
    if (achtervoegsel === 'mrd' || achtervoegsel === 'miljard' || achtervoegsel === 'b') {
        factor = 1e9;
    } else if (
        achtervoegsel === 'mln' ||
        achtervoegsel === 'miljoen' ||
        achtervoegsel === 'm'
    ) {
        factor = 1e6;
    } else if (achtervoegsel === 'duizend' || achtervoegsel === 'k') {
        factor = 1e3;
    }

    if (factor > 1) {
        // Bij een achtervoegsel is het scheidingsteken een decimaalteken.
        const getal = parseFloat(ruw.replace(/\s/g, '').replace(',', '.'));
        return Number.isNaN(getal) ? null : Math.round(getal * factor);
    }
    // Zonder achtervoegsel zijn punten/komma's duizendscheiders.
    const getal = parseInt(ruw.replace(/[.,\s]/g, ''), 10);
    return Number.isNaN(getal) ? null : getal;
}

/** Zet "1:23" of "12:03:45" om naar seconden. */
function duurNaarSeconden(tekst) {
    if (!tekst) return null;
    const delen = String(tekst)
        .split(':')
        .map((d) => parseInt(d, 10));
    if (delen.some((d) => Number.isNaN(d))) return null;
    return delen.reduce((totaal, d) => totaal * 60 + d, 0);
}

/**
 * Lees video's uit de HTML van een YouTube-zoekpagina.
 * Werkt op de ytInitialData-JSON die YouTube inline meestuurt.
 *
 * @param {string} html
 * @returns {Array<{videoId, titel, kanaal, duurSeconden}>}
 */
function leesResultaten(html) {
    const start = html.indexOf('ytInitialData');
    if (start < 0) return [];

    // Pak het JSON-object achter "ytInitialData = " tot de afsluitende ;
    const gelijk = html.indexOf('=', start);
    if (gelijk < 0) return [];
    const rest = html.slice(gelijk + 1);
    const eind = rest.indexOf(';</script>');
    const ruw = (eind > 0 ? rest.slice(0, eind) : rest).trim();

    let data;
    try {
        data = JSON.parse(ruw);
    } catch {
        return [];
    }

    const gevonden = [];

    // Loop recursief door de payload en verzamel videoRenderer-objecten.
    const bezoek = (knoop) => {
        if (!knoop || typeof knoop !== 'object') return;
        if (Array.isArray(knoop)) {
            for (const item of knoop) bezoek(item);
            return;
        }
        const vr = knoop.videoRenderer;
        if (vr && vr.videoId) {
            const titel =
                (vr.title &&
                    vr.title.runs &&
                    vr.title.runs[0] &&
                    vr.title.runs[0].text) ||
                '';
            const kanaal =
                (vr.ownerText &&
                    vr.ownerText.runs &&
                    vr.ownerText.runs[0] &&
                    vr.ownerText.runs[0].text) ||
                '';
            const duurTekst =
                (vr.lengthText && vr.lengthText.simpleText) || null;
            // Weergaven staan soms in simpleText, soms in runs.
            const viewsTekst =
                (vr.viewCountText && vr.viewCountText.simpleText) ||
                (vr.viewCountText &&
                    vr.viewCountText.runs &&
                    vr.viewCountText.runs.map((r) => r.text).join('')) ||
                null;
            gevonden.push({
                videoId: vr.videoId,
                titel,
                kanaal,
                duurSeconden: duurNaarSeconden(duurTekst),
                views: viewsNaarGetal(viewsTekst),
            });
        }
        for (const sleutel of Object.keys(knoop)) {
            if (sleutel === 'videoRenderer') continue;
            bezoek(knoop[sleutel]);
        }
    };
    bezoek(data);

    return gevonden;
}

/**
 * Lees de video's uit een YouTube-playlist.
 *
 * Waarom: een playlist als "Nederlandse tv-series intro's" bevat per
 * definitie de juiste intro's. Dat is veel betrouwbaarder dan zoeken.
 *
 * @param {string} playlistId
 * @returns {Promise<Array<{videoId, titel, kanaal}>>}
 */
async function haalPlaylist(playlistId) {
    const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    const headers = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
        Cookie: 'CONSENT=YES+cb; SOCS=CAI',
    };

    let laatsteStatus = 0;
    for (let poging = 0; poging < 4; poging++) {
        const resp = await fetch(url, { headers });
        if (resp.ok) {
            const html = await resp.text();
            return leesPlaylistItems(html);
        }
        laatsteStatus = resp.status;
        if (resp.status !== 429 && resp.status !== 403) break;
        await new Promise((r) => setTimeout(r, 4000 * Math.pow(2, poging)));
    }
    throw new Error(`YouTube playlist status ${laatsteStatus}`);
}

/** Haal playlistVideoRenderer-items uit de ytInitialData van een playlist. */
function leesPlaylistItems(html) {
    const start = html.indexOf('ytInitialData');
    if (start < 0) return [];
    const gelijk = html.indexOf('=', start);
    if (gelijk < 0) return [];
    const rest = html.slice(gelijk + 1);
    const eind = rest.indexOf(';</script>');
    const ruw = (eind > 0 ? rest.slice(0, eind) : rest).trim();

    let data;
    try {
        data = JSON.parse(ruw);
    } catch {
        return [];
    }

    const items = [];
    const bezoek = (knoop) => {
        if (!knoop || typeof knoop !== 'object') return;
        if (Array.isArray(knoop)) {
            for (const k of knoop) bezoek(k);
            return;
        }
        const pv = knoop.playlistVideoRenderer;
        if (pv && pv.videoId) {
            const titel =
                (pv.title && pv.title.runs && pv.title.runs[0] && pv.title.runs[0].text) ||
                (pv.title && pv.title.simpleText) ||
                '';
            const kanaal =
                (pv.shortBylineText &&
                    pv.shortBylineText.runs &&
                    pv.shortBylineText.runs[0] &&
                    pv.shortBylineText.runs[0].text) ||
                '';
            const duurTekst =
                (pv.lengthText && pv.lengthText.simpleText) || null;
            items.push({
                videoId: pv.videoId,
                titel,
                kanaal,
                duurSeconden: duurNaarSeconden(duurTekst),
                views: null,
            });
        }
        for (const s of Object.keys(knoop)) {
            if (s === 'playlistVideoRenderer') continue;
            bezoek(knoop[s]);
        }
    };
    bezoek(data);
    return items;
}

/** Zoek via de officiële Data API (alleen als er een key is ingesteld). */
async function zoekViaApi(term, limiet) {
    const params = new URLSearchParams({
        key: process.env.YOUTUBE_API_KEY,
        part: 'snippet',
        q: term,
        type: 'video',
        maxResults: String(limiet),
        videoEmbeddable: 'true',
    });
    const resp = await fetch(`${API_URL}?${params.toString()}`);
    if (!resp.ok) throw new Error(`YouTube API status ${resp.status}`);
    const data = await resp.json();
    return (data.items || []).map((i) => ({
        videoId: i.id.videoId,
        titel: i.snippet.title,
        kanaal: i.snippet.channelTitle,
        duurSeconden: null,
    }));
}

/**
 * Zoek video's op YouTube.
 * @param {string} term
 * @param {object} [opties] { limiet }
 */
async function zoek(term, opties = {}) {
    const limiet = opties.limiet || 10;
    if (!term || !term.trim()) return [];

    if (process.env.YOUTUBE_API_KEY) {
        try {
            return await zoekViaApi(term.trim(), limiet);
        } catch (err) {
            logger.waarschuwing('YouTube API mislukt, val terug op zoekpagina.', {
                melding: err.message,
            });
        }
    }

    const params = new URLSearchParams({ search_query: term.trim() });
    const url = `${ZOEK_URL}?${params.toString()}`;
    const headers = {
        // Een normale browser-UA en taal, plus de consent-cookie zodat
        // YouTube meteen resultaten geeft in plaats van een cookiemuur.
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
        Cookie: 'CONSENT=YES+cb; SOCS=CAI',
    };

    // YouTube knijpt af bij te veel verzoeken (429/403). Rustig opnieuw
    // proberen met oplopende wachttijd in plaats van de titel opgeven.
    let laatsteStatus = 0;
    for (let poging = 0; poging < 4; poging++) {
        const resp = await fetch(url, { headers });
        if (resp.ok) {
            const html = await resp.text();
            return leesResultaten(html).slice(0, limiet);
        }
        laatsteStatus = resp.status;
        if (resp.status !== 429 && resp.status !== 403) break;
        const wacht = 4000 * Math.pow(2, poging); // 4s, 8s, 16s, 32s
        logger.waarschuwing('YouTube knijpt af, even wachten.', {
            status: resp.status,
            wacht_ms: wacht,
        });
        await new Promise((r) => setTimeout(r, wacht));
    }
    throw new Error(`YouTube zoekpagina status ${laatsteStatus}`);
}

/**
 * Bouw zoektermen voor een titel, in volgorde van kans op succes.
 * Series → intro / theme song; films → official theme / soundtrack.
 * Er worden meerdere varianten geprobeerd zodat er weinig missers zijn.
 *
 * @returns {string[]}
 */
function zoektermenVoor(titel) {
    if (titel.yt_zoekterm) return [titel.yt_zoekterm];
    const naam = titel.naam;
    const jaar = titel.jaar ? ` ${titel.jaar}` : '';

    if (titel.type === 'serie') {
        // 'intro' levert de herkenbare titelsequentie op; 'soundtrack' geeft
        // vaak een willekeurig albumnummer en staat daarom achteraan.
        const termen = [`${naam} intro`];
        if (titel.taal === 'nl') termen.push(`${naam} titelsong`);
        termen.push(
            `${naam} opening theme`,
            `${naam} theme song`,
            `${naam} soundtrack`,
        );
        return termen;
    }

    // Films: het jaartal erbij, want delen uit een reeks hebben elk hun
    // eigen muziek (Pirates 2003 vs 2006, enzovoort).
    return [
        `${naam}${jaar} main theme`,
        `${naam}${jaar} official theme`,
        `${naam}${jaar} soundtrack main title`,
        `${naam} theme song`,
        `${naam}${jaar} soundtrack`,
    ];
}

/** Eén term (eerste keuze) — handig voor losse aanroepen. */
function zoektermVoor(titel) {
    return zoektermenVoor(titel)[0];
}

/**
 * Zoek de best passende intro/themesong voor een titel. Probeert meerdere
 * zoektermen tot er een bruikbare treffer is, en kiest binnen de treffers
 * op weergaven.
 *
 * @returns {Promise<object|null>}
 */
async function zoekVoorTitel(titel, opties = {}) {
    const termen = zoektermenVoor(titel);
    let beste = null;

    for (const term of termen) {
        let videos;
        try {
            videos = await zoek(term, { limiet: opties.limiet || 12 });
        } catch (err) {
            // Netwerk-/blokkadefout: laat de aanroeper dit weten.
            if (!beste) throw err;
            break;
        }
        const keuze = kiesBeste(videos, titel);
        if (keuze) {
            // Meer weergaven dan een eerdere treffer? Dan die nemen.
            if (!beste || (keuze.views ?? 0) > (beste.views ?? 0)) {
                beste = keuze;
            }
            // Een treffer met flink wat weergaven is goed genoeg.
            if ((keuze.views ?? 0) > 50000) break;
        }
        if (opties.pauzeMs) await new Promise((r) => setTimeout(r, opties.pauzeMs));
    }
    return beste;
}

// Signaalwoorden, gewogen. Een 'intro' of 'titelsong' is precies wat we
// zoeken; 'soundtrack' of 'score' is vaak zomaar een albumnummer en telt
// daarom lichter mee.
const SIGNAAL_NIVEAUS = [
    { niveau: 3, woorden: ['intro', 'titelsong', 'titelmuziek', 'opening', 'main title', 'generiek', 'tune'] },
    { niveau: 2, woorden: ['main theme', 'theme song', 'official theme', 'title theme'] },
    { niveau: 1, woorden: ['theme', 'title'] },
    { niveau: 0.5, woorden: ['soundtrack', 'ost', 'score'] },
];

// Alle signaalwoorden samen (voor de eerdere, ongewogen controle).
const GOEDE_WOORDEN = SIGNAAL_NIVEAUS.flatMap((n) => n.woorden);

/** Hoe sterk kondigt deze videotitel zich aan als intro/thema? */
function signaalNiveau(videoTitel) {
    const t = normaliseer(videoTitel);
    for (const { niveau, woorden } of SIGNAAL_NIVEAUS) {
        if (woorden.some((w) => t.includes(w))) return niveau;
    }
    return 0;
}
// Woorden die we juist niet willen (reacties, uitleg, hele afleveringen).
const SLECHTE_WOORDEN = [
    'reaction', 'review', 'explained', 'trailer', 'full episode',
    'hele aflevering', 'behind the scenes', 'making of', 'interview',
    'tutorial', 'cover by', 'karaoke', 'lyrics only', 'compilation',
    '1 hour', '10 hours', 'uur lang',
];

function normaliseer(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

/**
 * Weiger titels met niet-Latijns schrift (Arabisch, Cyrillisch, Hebreeuws,
 * Chinees/Japans/Koreaans, Thai, Devanagari). Zulke treffers horen vrijwel
 * nooit bij de gezochte film of serie.
 */
const NIET_LATIJN =
    /[Ѐ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿⺀-鿿가-힯ﭐ-﷿ﹰ-﻿]/;

function isLatijnsSchrift(tekst) {
    return !NIET_LATIJN.test(String(tekst || ''));
}

/**
 * Kies uit de zoekresultaten de meest waarschijnlijke intro/themesong.
 *
 * Werkwijze: eerst op relevantie filteren (titelnaam moet voorkomen, geen
 * reacties/trailers/afleveringen, redelijke duur) en daarna binnen de
 * overgebleven kandidaten de video met de **meeste weergaven** kiezen.
 * De bovenste zoektreffer is namelijk vaak niet de beste versie.
 *
 * Puur en testbaar.
 */
function kiesBeste(resultaten, titel) {
    if (!resultaten || resultaten.length === 0) return null;
    const naamNorm = normaliseer(titel.naam);

    // Basiseisen: naam komt voor, niets ongewensts, duur plausibel.
    const bruikbaar = resultaten.filter((r) => {
        const t = normaliseer(r.titel);
        // Nooit resultaten met Arabisch/Cyrillisch/CJK e.d.
        if (!isLatijnsSchrift(r.titel)) return false;
        if (naamNorm && !t.includes(naamNorm)) return false;
        if (SLECHTE_WOORDEN.some((w) => t.includes(w))) return false;
        if (r.duurSeconden != null) {
            if (r.duurSeconden < MIN_SECONDEN) return false;
            if (r.duurSeconden > MAX_SECONDEN) return false;
        }
        return true;
    });

    if (bruikbaar.length === 0) return null;

    // Eerst op sóórt kiezen: een 'intro' wint van een willekeurig
    // soundtrack-nummer, ook als dat laatste meer weergaven heeft.
    let hoogste = 0;
    for (const r of bruikbaar) {
        const n = signaalNiveau(r.titel);
        if (n > hoogste) hoogste = n;
    }
    const groep =
        hoogste > 0
            ? bruikbaar.filter((r) => signaalNiveau(r.titel) === hoogste)
            : bruikbaar;

    // Binnen dezelfde soort: de populairste wint (meeste weergaven).
    const gesorteerd = groep.slice().sort((a, b) => {
        const va = a.views ?? -1;
        const vb = b.views ?? -1;
        if (vb !== va) return vb - va;
        // Geen weergaven bekend? Dan de kortere (meestal de pure intro).
        return (a.duurSeconden ?? 9999) - (b.duurSeconden ?? 9999);
    });

    return gesorteerd[0];
}

module.exports = {
    zoek,
    zoekVoorTitel,
    haalPlaylist,
    leesPlaylistItems,
    leesResultaten,
    normaliseer,
    isLatijnsSchrift,
    kiesBeste,
    zoektermVoor,
    zoektermenVoor,
    duurNaarSeconden,
    viewsNaarGetal,
};
