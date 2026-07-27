const assert = require('assert/strict');
const { beoordeelTrackMetDetails } = require('../lib/tmdb');
const { leeftijdsgrensVoorGenres, berekenCatalogusOmvang } = require('../../seed/tmdb-import');
const { veiligeTiteltekst } = require('../lib/content-filter');

const gooische = {
    naam: 'Gooische Vrouwen',
    aliassen: ['Gooise Vrouwen'],
    jaar: 2005,
};

assert.equal(
    beoordeelTrackMetDetails(
        gooische,
        { tracknaam: 'Gooische Vrouwen intro' },
        { naam: 'Gooische Vrouwen', origineleNaam: 'Gooische Vrouwen', jaar: 2005 },
    ).past,
    true,
);

assert.equal(leeftijdsgrensVoorGenres(['Familie']), 6);
assert.equal(leeftijdsgrensVoorGenres(['Fantasy']), 9);
assert.equal(leeftijdsgrensVoorGenres(['Horror']), 16);

// Inclusief tellen: 1980 t/m 2026 zijn 47 jaartallen en 1950 t/m 2026
// zijn 77 jaartallen. De plafonds zijn bewust lager dan de oude vaste top100/
// top50-lijsten; de werkelijke populaire lijst mag per jaar kleiner zijn.
assert.deepEqual(
    berekenCatalogusOmvang({ startJaar: 1980, eindJaar: 2026 }),
    {
        jaren: 47,
        nederlandstaligeJaren: 77,
        films: 2350,
        series: 1175,
        nederlandstaligeFilms: 770,
        nederlandstaligeSeries: 770,
        cultClassics: 24,
        iconischeVangnetSeries: 1,
    },
);

assert.equal(veiligeTiteltekst('Commissaris Max'), true);
assert.equal(veiligeTiteltekst('The Office (US)'), true);
assert.equal(veiligeTiteltekst('Русский фильм'), false);
assert.equal(veiligeTiteltekst('فيلم عربي'), false);

// Een bekende lokale afkorting blijft geldig als TMDB de officiële titel
// bevestigt (bijvoorbeeld GTST versus Goede Tijden Slechte Tijden).
assert.equal(
    beoordeelTrackMetDetails(
        { naam: 'Goede Tijden Slechte Tijden', aliassen: ['GTST'], jaar: 1990 },
        { tracknaam: 'GTST intro' },
        { naam: 'Goede Tijden, Slechte Tijden', origineleNaam: null, jaar: 1990 },
    ).past,
    true,
);

assert.equal(
    beoordeelTrackMetDetails(
        { naam: 'Flodder', aliassen: [], jaar: 1986 },
        { tracknaam: 'Flodder intro (1986)' },
        { naam: 'Gooische Vrouwen', origineleNaam: null, jaar: 2005 },
    ).past,
    false,
);

assert.equal(
    beoordeelTrackMetDetails(
        gooische,
        { tracknaam: 'Gooische Vrouwen intro (2005)' },
        { naam: 'Gooische Vrouwen', origineleNaam: null, jaar: 2011 },
    ).past,
    false,
);

console.log('tmdb: tweede titel- en jaarcontrole geslaagd');
