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
const cache = require('./cache');
const { pastBijTitel } = require('./trackcheck');

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
    const data = leesYtInitialData(html);
    if (!data) return [];

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
async function haalPlaylistHtml(playlistId) {
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
        if (resp.ok) return resp.text();
        laatsteStatus = resp.status;
        if (resp.status !== 429 && resp.status !== 403) break;
        await new Promise((r) => setTimeout(r, 4000 * Math.pow(2, poging)));
    }
    throw new Error(`YouTube playlist status ${laatsteStatus}`);
}

async function haalPlaylist(playlistId, opties = {}) {
    if (opties.cache !== false) {
        const bestaand = await cache.lees('playlist', playlistId);
        if (bestaand) return bestaand;
    }
    const html = await haalPlaylistHtml(playlistId);
    const items = leesPlaylistItems(html);
    if (items.length > 0 && opties.cache !== false) {
        await cache.schrijf('playlist', playlistId, items);
    }
    return items;
}

/**
 * Haal de ytInitialData-JSON uit een YouTube-pagina.
 * Zoekt het begin van het object en leest tot de bijbehorende sluitaccolade,
 * zodat het ook werkt als er nog script-code achteraan staat.
 */
function leesYtInitialData(html) {
    const merk = html.indexOf('ytInitialData');
    if (merk < 0) return null;
    const begin = html.indexOf('{', merk);
    if (begin < 0) return null;

    let diepte = 0;
    let inTekst = false;
    let ontsnapt = false;
    for (let i = begin; i < html.length; i++) {
        const c = html[i];
        if (inTekst) {
            if (ontsnapt) ontsnapt = false;
            else if (c === '\\') ontsnapt = true;
            else if (c === '"') inTekst = false;
            continue;
        }
        if (c === '"') inTekst = true;
        else if (c === '{') diepte++;
        else if (c === '}') {
            diepte--;
            if (diepte === 0) {
                try {
                    return JSON.parse(html.slice(begin, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * Haal video's uit de ytInitialData van een playlistpagina.
 *
 * YouTube wijzigt de opbouw van deze pagina's regelmatig. Daarom lopen we
 * de hele payload door en pakken elk object dat een video beschrijft,
 * ongeacht hoe het heet: playlistVideoRenderer (klassiek), lockupViewModel
 * (nieuw), of iets anders met een videoId plus titel.
 */
function leesPlaylistItems(html) {
    const data = leesYtInitialData(html);
    if (!data) return [];

    const items = [];
    const gezien = new Set();

    const tekstUit = (veld) => {
        if (!veld) return '';
        if (typeof veld === 'string') return veld;
        if (veld.simpleText) return veld.simpleText;
        if (veld.content) return veld.content;
        if (Array.isArray(veld.runs)) {
            return veld.runs.map((r) => r.text || '').join('');
        }
        return '';
    };

    const voegToe = (videoId, titel, kanaal, duurTekst) => {
        if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
        if (gezien.has(videoId)) return;
        if (!titel) return;
        gezien.add(videoId);
        items.push({
            videoId,
            titel,
            kanaal: kanaal || '',
            duurSeconden: duurNaarSeconden(duurTekst),
            views: null,
        });
    };

    const bezoek = (knoop) => {
        if (!knoop || typeof knoop !== 'object') return;
        if (Array.isArray(knoop)) {
            for (const k of knoop) bezoek(k);
            return;
        }

        // Klassiek: playlistVideoRenderer / videoRenderer.
        for (const naam of ['playlistVideoRenderer', 'videoRenderer']) {
            const v = knoop[naam];
            if (v && v.videoId) {
                voegToe(
                    v.videoId,
                    tekstUit(v.title),
                    tekstUit(v.shortBylineText) || tekstUit(v.ownerText),
                    v.lengthText && v.lengthText.simpleText,
                );
            }
        }

        // Nieuw: lockupViewModel met contentId + metadata.
        const lockup = knoop.lockupViewModel;
        if (lockup && lockup.contentId) {
            const meta = lockup.metadata && lockup.metadata.lockupMetadataViewModel;
            const titel = meta ? tekstUit(meta.title) : '';
            let kanaal = '';
            try {
                const rijen =
                    meta.metadata.contentMetadataViewModel.metadataRows || [];
                for (const rij of rijen) {
                    for (const deel of rij.metadataParts || []) {
                        const t = tekstUit(deel.text);
                        if (t && !kanaal) kanaal = t;
                    }
                }
            } catch {
                /* kanaal is optioneel */
            }
            voegToe(lockup.contentId, titel, kanaal, null);
        }

        for (const sleutel of Object.keys(knoop)) {
            bezoek(knoop[sleutel]);
        }
    };
    bezoek(data);

    return items;
}

/**
 * Diagnose-hulp: welke soorten video-objecten komen in deze pagina voor?
 * Gebruikt door seed/diagnose-playlist.js zodat we niet hoeven te gokken
 * als YouTube de opbouw weer wijzigt.
 */
function inspecteerPagina(html) {
    const data = leesYtInitialData(html);
    const uitkomst = {
        ytInitialDataGevonden: !!data,
        htmlLengte: html.length,
        sleutels: {},
        videoIdVoorkomens: (html.match(/"videoId":"[A-Za-z0-9_-]{11}"/g) || []).length,
        contentIdVoorkomens: (html.match(/"contentId":"[A-Za-z0-9_-]{11}"/g) || []).length,
        cookiemuur: /consent\.youtube\.com|Voordat je verdergaat|Before you continue/i.test(html),
    };
    if (!data) return uitkomst;

    const tel = (knoop) => {
        if (!knoop || typeof knoop !== 'object') return;
        if (Array.isArray(knoop)) {
            for (const k of knoop) tel(k);
            return;
        }
        for (const s of Object.keys(knoop)) {
            if (/Renderer$|ViewModel$/.test(s)) {
                uitkomst.sleutels[s] = (uitkomst.sleutels[s] || 0) + 1;
            }
            tel(knoop[s]);
        }
    };
    tel(data);
    return uitkomst;
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

    // Eerder opgehaald? Dan die gebruiken — voorkomt herhaald netwerkverkeer
    // en de 429/403-limieten van YouTube.
    if (opties.cache !== false) {
        const bestaand = await cache.lees('youtube', term.trim());
        if (bestaand) return bestaand.slice(0, limiet);
    }

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
            const items = leesResultaten(html);
            if (items.length > 0 && opties.cache !== false) {
                await cache.schrijf('youtube', term.trim(), items);
            }
            return items.slice(0, limiet);
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
    const expliciet = titel.yt_zoekterm || titel.youtube_zoekterm;
    const naam = titel.naam;
    const jaar = titel.jaar ? ` ${titel.jaar}` : '';
    const namen = [...new Set([naam, ...(titel.aliassen || [])].filter(Boolean))];
    const termen = [];

    if (titel.type === 'serie') {
        // 'intro' levert de herkenbare titelsequentie op; 'soundtrack' geeft
        // vaak een willekeurig albumnummer en staat daarom achteraan.
        for (const kandidaat of namen) {
            termen.push(`${kandidaat} intro`);
            if (titel.taal === 'nl') termen.push(`${kandidaat} titelsong`);
        }
        termen.push(
            `${naam} opening theme`,
            `${naam} theme song`,
            `${naam} soundtrack`,
        );
    } else {
        // Films: het jaartal erbij, want delen uit een reeks hebben elk hun
        // eigen muziek (Pirates 2003 vs 2006, enzovoort).
        termen.push(
            `${naam}${jaar} main theme`,
            `${naam}${jaar} official theme`,
            `${naam}${jaar} soundtrack main title`,
            `${naam} theme song`,
            `${naam}${jaar} soundtrack`,
        );
    }

    // Een expliciete zoekterm is nuttig als aanvulling, maar mag de veilige
    // titelgerichte zoektermen niet volledig vervangen.
    if (titel.zoekterm) termen.push(titel.zoekterm);
    if (expliciet) termen.push(expliciet);
    return [...new Set(termen)];
}

/** Eén term (eerste keuze) — handig voor losse aanroepen. */
function zoektermVoor(titel) {
    return zoektermenVoor(titel)[0];
}

/**
 * Zoek de best passende intro/themesong voor een titel. Probeert meerdere
 * zoektermen tot er een bruikbare treffer is, en kiest binnen de treffers
 * op verificatie, type signaal en daarna weergaven.
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
            // De score is belangrijker dan alleen populariteit. Zo wint een
            // echte intro van een willekeurig soundtracknummer met meer views.
            if (
                !beste ||
                keuze._keuzeScore > beste._keuzeScore ||
                (keuze._keuzeScore === beste._keuzeScore && (keuze.views ?? 0) > (beste.views ?? 0))
            ) {
                beste = keuze;
            }
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
    'live performance', 'live concert', 'livestream', '1 hour', '10 hours',
    'uur lang',
];
const LIVE_TITEL = /\blive\b|\blivestream\b|\blive\s+stream\b/i;

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
 * Werkwijze: eerst op titel/alias, jaartal, inhoud en duur filteren. Daarna
 * wint een geverifieerde intro van een willekeurig soundtracknummer; pas
 * binnen dezelfde kwaliteitsklasse tellen weergaven en duur mee.
 *
 * Puur en testbaar.
 */
function kiesBeste(resultaten, titel) {
    if (!resultaten || resultaten.length === 0) return null;
    // Basiseisen: naam komt voor, niets ongewensts, duur plausibel.
    const bruikbaar = resultaten.map((r) => {
        const t = normaliseer(r.titel);
        // Nooit resultaten met Arabisch/Cyrillisch/CJK e.d.
        if (!isLatijnsSchrift(r.titel)) return null;
        // Een live-uitvoering is nooit de bedoelde intro/titelsong. Dit is
        // expres een harde weigering; ook een zeer populaire livevideo mag
        // niet winnen van een minder populaire studioversie.
        if (LIVE_TITEL.test(t)) return null;
        if (SLECHTE_WOORDEN.some((w) => t.includes(w))) return null;
        // Een automatische zoekopdracht moet expliciet naar muziek voor de
        // titel wijzen. Een exact klinkende naam zonder theme/intro-signaal
        // is vaak een willekeurig nummer met dezelfde zoekwoorden.
        const minimumSignaal = titel?.type === 'serie' ? 2 : 1;
        if (signaalNiveau(r.titel) < minimumSignaal) return null;
        if (r.duurSeconden != null) {
            if (r.duurSeconden < MIN_SECONDEN || r.duurSeconden > MAX_SECONDEN) return null;
        }
        const controle = pastBijTitel(titel, {
            tracknaam: r.titel,
            artiest: r.kanaal,
        });
        if (!controle.past) return null;
        return { ...r, _controle: controle };
    }).filter(Boolean);

    if (bruikbaar.length === 0) return null;

    // Eerst verificatie, daarna soort resultaat, pas daarna populariteit.
    const gesorteerd = bruikbaar.slice().map((r) => ({
        ...r,
        _keuzeScore: Math.round((r._controle.zekerheid || 0) * 100) + signaalNiveau(r.titel) * 20,
    })).sort((a, b) => {
        if (b._keuzeScore !== a._keuzeScore) return b._keuzeScore - a._keuzeScore;
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
    haalPlaylistHtml,
    leesPlaylistItems,
    leesYtInitialData,
    inspecteerPagina,
    leesResultaten,
    normaliseer,
    isLatijnsSchrift,
    kiesBeste,
    zoektermVoor,
    zoektermenVoor,
    duurNaarSeconden,
    viewsNaarGetal,
};
