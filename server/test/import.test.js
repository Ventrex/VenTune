const assert = require('assert/strict');
const fixtures = require('./fixtures/track-matches.json');
const { pastBijTitel } = require('../lib/trackcheck');
const { kiesBeste } = require('../../seed/import');

for (const item of fixtures.positive) {
    assert.equal(pastBijTitel(item.titel, item.track).past, true, item.track.tracknaam);
}
for (const item of fixtures.negative) {
    assert.equal(pastBijTitel(item.titel, item.track).past, false, item.track.tracknaam);
}

const kandidaten = [
    { tracknaam: 'Gooische Vrouwen titelsong', album: 'TV Tunes', preview_url: 'wrong' },
    { tracknaam: 'Flodder intro (1986)', album: 'TV Tunes', preview_url: 'right' },
];
assert.equal(kiesBeste(kandidaten, fixtures.positive[0].titel).preview_url, 'right');
assert.equal(
    kiesBeste([{ tracknaam: 'Little Bit of Love', album: 'Random Album' }], { naam: 'It', jaar: 2017 }),
    null,
);

console.log('import: alle fixtures geslaagd');
