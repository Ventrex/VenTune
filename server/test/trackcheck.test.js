const assert = require('assert/strict');
const { pastBijTitel } = require('../lib/trackcheck');
const { matchTitel } = require('../lib/title-match');

function goed(titel, track) {
    assert.equal(pastBijTitel(titel, track).past, true, `${titel.naam} had moeten matchen`);
}

function fout(titel, track) {
    assert.equal(pastBijTitel(titel, track).past, false, `${titel.naam} had niet mogen matchen`);
}

const flodder = { id: 1, naam: 'Flodder', aliassen: [], jaar: 1986 };
const gtst = {
    id: 2,
    naam: 'Goede Tijden Slechte Tijden',
    aliassen: ['GTST'],
    jaar: 1990,
};
const gooische = { id: 3, naam: 'Gooische Vrouwen', aliassen: ['Gooise Vrouwen'], jaar: 2005 };

goed(flodder, { tracknaam: 'Flodder intro (1986)', artiest: 'Nederlandse TV' });
goed(gtst, { tracknaam: 'GTST intro', artiest: 'TV Tunes' });
goed(gooische, { tracknaam: 'Gooische Vrouwen titelsong', artiest: 'TV Tunes' });
fout(flodder, { tracknaam: 'Gooische Vrouwen titelsong', artiest: 'TV Tunes' });
fout({ naam: 'Pirates of the Caribbean', jaar: 2003 }, {
    tracknaam: 'Pirates of the Caribbean theme (2006)',
});
fout({ naam: 'It', jaar: 2017 }, { tracknaam: 'Little Bit of Love' });

assert.equal(
    matchTitel('Flodder intro (1986)', [flodder, gtst, gooische]).titel.naam,
    'Flodder',
);
assert.equal(
    matchTitel('GTST intro', [flodder, gtst, gooische]).titel.naam,
    'Goede Tijden Slechte Tijden',
);
assert.equal(matchTitel('onbekende muziek', [flodder, gtst, gooische]), null);

console.log('trackcheck: alle tests geslaagd');
