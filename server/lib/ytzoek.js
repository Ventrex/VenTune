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
            gevonden.push({
                videoId: vr.videoId,
                titel,
                kanaal,
                duurSeconden: duurNaarSeconden(duurTekst),
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
    const resp = await fetch(`${ZOEK_URL}?${params.toString()}`, {
        headers: {
            // Een normale browser-UA en taal, plus de consent-cookie zodat
            // YouTube meteen resultaten geeft in plaats van een cookiemuur.
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
            Cookie: 'CONSENT=YES+cb; SOCS=CAI',
        },
    });
    if (!resp.ok) throw new Error(`YouTube zoekpagina status ${resp.status}`);

    const html = await resp.text();
    const resultaten = leesResultaten(html);
    return resultaten.slice(0, limiet);
}

/**
 * Bouw een goede YouTube-zoekterm voor een titel.
 * Series → intro/tune; films → soundtrack/main theme.
 */
function zoektermVoor(titel) {
    if (titel.yt_zoekterm) return titel.yt_zoekterm;
    const naam = titel.naam;
    if (titel.type === 'serie') {
        return titel.taal === 'nl'
            ? `${naam} intro tune titelsong`
            : `${naam} intro theme song`;
    }
    const jaar = titel.jaar ? ` ${titel.jaar}` : '';
    return titel.taal === 'nl'
        ? `${naam}${jaar} soundtrack muziek thema`
        : `${naam}${jaar} soundtrack main theme`;
}

// Woorden die wijzen op precies wat we willen.
const GOEDE_WOORDEN = [
    'intro', 'opening', 'theme', 'title', 'titelsong', 'titelmuziek',
    'tune', 'soundtrack', 'main theme', 'ost', 'score', 'generiek',
];
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
 * Kies uit de zoekresultaten de meest waarschijnlijke intro/themesong.
 * Puur en testbaar.
 */
function kiesBeste(resultaten, titel) {
    if (!resultaten || resultaten.length === 0) return null;
    const naamNorm = normaliseer(titel.naam);

    let beste = null;
    let besteScore = -Infinity;

    resultaten.forEach((r, index) => {
        const t = normaliseer(r.titel);
        let score = 0;

        // De titelnaam moet er echt in zitten.
        if (naamNorm && t.includes(naamNorm)) score += 6;

        // Intro/theme-signalen.
        if (GOEDE_WOORDEN.some((w) => t.includes(w))) score += 4;

        // Ongewenste video's hard afstraffen.
        if (SLECHTE_WOORDEN.some((w) => t.includes(w))) score -= 8;

        // Duur: intro's en thema's zijn kort tot middellang.
        if (r.duurSeconden != null) {
            if (r.duurSeconden < MIN_SECONDEN) score -= 5;
            else if (r.duurSeconden <= 6 * 60) score += 3;
            else if (r.duurSeconden > MAX_SECONDEN) score -= 6;
        }

        // Lichte voorkeur voor YouTube's eigen volgorde.
        score -= index * 0.3;

        if (score > besteScore) {
            besteScore = score;
            beste = r;
        }
    });

    // Alles negatief? Dan is er niets bruikbaars gevonden.
    if (besteScore < 0) return null;
    return beste;
}

module.exports = {
    zoek,
    leesResultaten,
    kiesBeste,
    zoektermVoor,
    duurNaarSeconden,
};
