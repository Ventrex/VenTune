// =====================================================================
// Controle: hoort deze muziek écht bij deze titel?
//
// Waarom dit bestaat: zonder controle kan er muziek van de ene film onder
// de naam van een andere komen te staan (bijvoorbeeld Frozen's "Let It Go"
// bij "Het Gouden Uur"). Dan is het spel onbruikbaar. Alles wat een track
// aan een titel koppelt, moet daarom eerst hier langs.
//
// Uitgangspunt: bij twijfel NIET spelen. Een ontbrekend nummer is
// vervelend, een verkeerd nummer maakt het spel waardeloos.
// =====================================================================

/** Lowercase, diakrieten weg, alleen letters/cijfers/spaties. */
function normaliseer(tekst) {
    return String(tekst || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' en ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Woorden die niets zeggen over wélke titel het is.
const RUIS = new Set([
    'de', 'het', 'een', 'the', 'a', 'an', 'van', 'of', 'and', 'en',
    'intro', 'outro', 'opening', 'openingstune', 'titelsong', 'titelmuziek',
    'tune', 'theme', 'song', 'main', 'title', 'titles', 'sequence',
    'soundtrack', 'ost', 'score', 'original', 'motion', 'picture', 'official',
    'video', 'audio', 'hd', 'hq', 'full', 'lyrics', 'remastered', 'suite',
    'generiek', 'leader', 'begintune', 'serie', 'series', 'season', 'seizoen',
    'aflevering', 'episode', 'from', 'music', 'muziek', 'thema', 'nederlandse',
    'nederlands', 'dutch', 'trailer', 'cover', 'live', 'version', 'mix',
    'feat', 'ft', 'part', 'deel', 'vol', 'edit', 'extended',
]);

/** Betekenisvolle woorden uit een naam (ruis en losse letters weg). */
function kernWoorden(tekst) {
    return normaliseer(tekst)
        .split(' ')
        .filter((w) => w.length > 1 && !RUIS.has(w) && !/^\d{4}$/.test(w));
}

/**
 * Controleer of een gevonden nummer bij een titel hoort.
 *
 * @param {object} titel  { naam, aliassen }
 * @param {object} track  { tracknaam, album, artiest, bron }
 * @returns {{past: boolean, zekerheid: number, reden: string}}
 */
function pastBijTitel(titel, track) {
    const namen = [titel.naam, ...(titel.aliassen || [])].filter(Boolean);
    // Alles waarin de titelnaam mag voorkomen: de naam van het nummer, het
    // album (soundtracks heten vaak naar de film) en de artiest.
    const hooi = normaliseer(
        [track.tracknaam, track.album, track.artiest].filter(Boolean).join(' '),
    );
    if (!hooi) return { past: false, zekerheid: 0, reden: 'geen tracknaam' };

    for (const naam of namen) {
        const genorm = normaliseer(naam);
        if (!genorm) continue;

        // 1. Volledige titelnaam komt letterlijk voor → zeker goed.
        if (genorm.length >= 3 && hooi.includes(genorm)) {
            return { past: true, zekerheid: 1, reden: 'volledige naam gevonden' };
        }

        // 2. Alle betekenisvolle woorden van de titel komen voor.
        const kern = kernWoorden(naam);
        if (kern.length > 0) {
            const hooiWoorden = new Set(hooi.split(' '));
            const raak = kern.filter((w) => hooiWoorden.has(w));
            if (raak.length === kern.length) {
                return {
                    past: true,
                    zekerheid: 0.9,
                    reden: 'alle kernwoorden gevonden',
                };
            }
            // 3. Bij langere namen mag één woord missen (bv. ondertitel).
            if (kern.length >= 3 && raak.length >= kern.length - 1) {
                return {
                    past: true,
                    zekerheid: 0.7,
                    reden: 'bijna alle kernwoorden gevonden',
                };
            }
        }
    }

    return {
        past: false,
        zekerheid: 0,
        reden: 'titelnaam komt niet voor in tracknaam/album/artiest',
    };
}

module.exports = { pastBijTitel, normaliseer, kernWoorden };
