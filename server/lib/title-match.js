// =====================================================================
// Koppeling van YouTube-playlisttitels aan titels uit de vragenbank.
// Alleen duidelijke matches worden teruggegeven. Bij een gelijkspel tussen
// twee titels wordt bewust niets gekoppeld.
// =====================================================================

const { normaliseer, bevatWoordreeks, titelNamen } = require('./trackcheck');

const RUIS = [
    'intro', 'outro', 'opening', 'openingstune', 'titelsong', 'titelmuziek',
    'tune', 'theme song', 'theme', 'main title', 'title sequence', 'generiek',
    'soundtrack', 'ost', 'hd', 'hq', 'full', 'lyrics', 'nederlandse',
    'nederlands', 'serie', 'tv serie', 'tvserie', 'leader', 'begintune',
    'aflevering', 'seizoen', 'season', 'opener', 'credits', 'original',
    'official', 'video', 'audio', 'remastered', 'compilatie',
];

/** Haal de vermoedelijke titelnaam uit een videotitel. */
function schoonTitel(videoTitel) {
    let t = normaliseer(videoTitel);
    t = t.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    t = t.split('|')[0];
    t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
    for (const woord of RUIS) {
        t = t.replace(new RegExp(`\\b${woord}\\b`, 'g'), ' ');
    }
    return t.replace(/\s+/g, ' ').trim();
}

/**
 * Zoek de beste titel voor een playlistvideo.
 *
 * De score is alleen bedoeld om sterke kandidaten te rangschikken; de
 * caller voert daarna nog de volledige trackcheck uit.
 */
function matchTitel(videoTitel, titels) {
    const schoon = schoonTitel(videoTitel);
    if (!schoon) return null;

    const kandidaten = [];
    for (const titel of titels) {
        for (const naam of titelNamen(titel)) {
            const genorm = normaliseer(naam);
            if (genorm.length < 3) continue;

            let score = 0;
            if (schoon === genorm) score = 100;
            else if (bevatWoordreeks(schoon, genorm)) score = 70 + genorm.length;
            else {
                const naamWoorden = genorm
                    .split(' ')
                    .filter((woord) => woord.length > 1);
                const videoWoorden = new Set(schoon.split(' '));
                if (naamWoorden.length && naamWoorden.every((woord) => videoWoorden.has(woord))) {
                    score = 35 + naamWoorden.length * 5;
                }
            }
            if (score > 0) kandidaten.push({ titel, score, naam });
        }
    }

    kandidaten.sort((a, b) => b.score - a.score);
    const beste = kandidaten[0];
    if (!beste || beste.score < 40) return null;

    // Twee verschillende titels met dezelfde sterke score zijn niet veilig
    // automatisch op te lossen. De playlist-import slaat die dan over.
    const gelijk = kandidaten.find(
        (k) => k.titel.id !== beste.titel.id && k.score === beste.score,
    );
    if (gelijk) return null;

    return { titel: beste.titel, score: beste.score, matchNaam: beste.naam };
}

module.exports = { schoonTitel, matchTitel };
