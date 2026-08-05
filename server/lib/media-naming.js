// Centrale naamgeving voor lokale audio.
//
// Voorbeeld:
//   Film/Flodder - 1986 - Komedie - NL.m4a
//   Serie/Stranger Things - 2016 - Drama - US.m4a
//
// Een collectie krijgt haar eigen basisfolder, maar daarbinnen staan altijd
// de herkenbare Film/Serie-mappen. Oude records zonder collectie blijven
// onder /media/Film en /media/Serie staan.

const path = require('path');

const LAND_CODES = [
    [/nederland|netherlands|dutch/, 'NL'],
    [/verenigde staten|united states|usa|america|amerikaanse/, 'US'],
    [/verenigd koninkrijk|united kingdom|great britain|england|british/, 'GB'],
    [/ierland|ireland|irish/, 'IE'],
    [/belgie|belgium|belgian/, 'BE'],
    [/duitsland|germany|german/, 'DE'],
    [/frankrijk|france|french/, 'FR'],
    [/spanje|spain|spanish/, 'ES'],
    [/italie|italy|italian/, 'IT'],
    [/japan|japanese/, 'JP'],
    [/zuid korea|south korea|korean/, 'KR'],
    [/canada|canadian/, 'CA'],
    [/australie|australia|australian/, 'AU'],
];

function normaliseer(waarde) {
    return String(waarde || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function veiligeNaam(waarde, fallback = 'onbekend') {
    const tekst = String(waarde || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\\/:*?"<>|]+/g, ' - ')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '');
    return tekst || fallback;
}

function typeMap(titel) {
    return titel?.type === 'serie' ? 'Serie' : 'Film';
}

function taalCode(titel) {
    const taal = normaliseer(titel?.taal);
    if (taal === 'nl' || taal.includes('nederlands') || taal.includes('dutch')) return 'NL';

    const land = normaliseer(titel?.land);
    for (const [patroon, code] of LAND_CODES) {
        if (patroon.test(land)) return code;
    }

    const talen = Array.isArray(titel?.talen) ? titel.talen : [];
    const eerste = normaliseer(talen[0]);
    if (eerste.includes('nederlands') || eerste.includes('dutch')) return 'NL';
    if (eerste.includes('engels') || eerste.includes('english')) return 'EN';
    if (eerste.includes('duits') || eerste.includes('german')) return 'DE';
    if (eerste.includes('frans') || eerste.includes('french')) return 'FR';
    if (eerste.includes('spaans') || eerste.includes('spanish')) return 'ES';
    if (eerste.includes('italiaans') || eerste.includes('italian')) return 'IT';
    if (eerste.includes('japans') || eerste.includes('japanese')) return 'JP';

    return taal === 'nl' ? 'NL' : taal === 'en' ? 'EN' : 'XX';
}

function genreNaam(titel) {
    const genre = Array.isArray(titel?.genres) ? titel.genres.find(Boolean) : null;
    return veiligeNaam(genre, 'Onbekend');
}

function releaseJaar(titel) {
    const jaar = Number(titel?.jaar);
    return Number.isFinite(jaar) && jaar > 0 ? String(Math.round(jaar)) : 'Onbekend';
}

function basisMap(mediaDir, titel, mediaMap = '') {
    const onderdelen = String(mediaMap || '')
        .split(/[\\/]+/)
        .filter((onderdeel) => onderdeel && onderdeel !== '.' && onderdeel !== '..')
        .map((onderdeel) => veiligeNaam(onderdeel));
    return path.join(mediaDir, ...onderdelen, typeMap(titel));
}

function bestandsnaam(titel, extensie = '.m4a', achtervoegsel = '') {
    const ext = String(extensie || '.m4a').startsWith('.')
        ? String(extensie || '.m4a')
        : `.${extensie}`;
    return `${veiligeNaam(titel?.naam, 'titel')} - ${releaseJaar(titel)} - ${genreNaam(titel)} - ${taalCode(titel)}${achtervoegsel}${ext}`;
}

function mediaWebpad(mediaDir, titel, mediaMap = '', extensie = '.m4a', achtervoegsel = '') {
    const bestand = path.join(basisMap(mediaDir, titel, mediaMap), bestandsnaam(titel, extensie, achtervoegsel));
    const relatief = path.relative(mediaDir, bestand);
    if (relatief.startsWith('..') || path.isAbsolute(relatief)) {
        throw new Error('Ongeldig lokaal mediapad.');
    }
    return {
        bestand,
        lokaal: `/media/${relatief.split(path.sep).join('/')}`,
        basis: path.dirname(bestand),
    };
}

function bestandsdelen(titel) {
    return {
        map: typeMap(titel),
        jaar: releaseJaar(titel),
        genre: genreNaam(titel),
        taal: taalCode(titel),
    };
}

module.exports = {
    veiligeNaam,
    typeMap,
    taalCode,
    genreNaam,
    releaseJaar,
    basisMap,
    bestandsnaam,
    mediaWebpad,
    bestandsdelen,
};
