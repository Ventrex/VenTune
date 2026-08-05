const assert = require('assert/strict');
const {
    bestandsnaam,
    mediaWebpad,
    taalCode,
} = require('../lib/media-naming');

const film = {
    naam: 'Spider-Man: No Way Home',
    type: 'film',
    jaar: 2021,
    genres: ['Actie'],
    taal: 'en',
    land: 'Verenigde Staten',
};
const serie = {
    naam: 'Flodder',
    type: 'serie',
    jaar: 1986,
    genres: ['Komedie'],
    taal: 'nl',
    land: 'Nederland',
};

assert.equal(
    bestandsnaam(film),
    'Spider-Man - No Way Home - 2021 - Actie - US.m4a',
);
assert.equal(bestandsnaam(serie), 'Flodder - 1986 - Komedie - NL.m4a');
assert.equal(
    mediaWebpad('/media', serie, 'collecties/top1000-films-series').lokaal,
    '/media/collecties/top1000-films-series/Serie/Flodder - 1986 - Komedie - NL.m4a',
);
assert.equal(taalCode({ taal: 'en', land: 'Verenigd Koninkrijk' }), 'GB');

console.log('media-naming: bestandsnamen en mappen geslaagd');

