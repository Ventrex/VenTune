const assert = require('assert/strict');
const { beoordeelTrackMetDetails } = require('../lib/tmdb');

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
