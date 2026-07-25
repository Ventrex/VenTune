const assert = require('assert/strict');
const { pastBijTitel } = require('../lib/trackcheck');
const { matchTitel } = require('../lib/title-match');
const { kiesBeste } = require('../lib/ytzoek');

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
const baantjer = { id: 4, naam: 'Baantjer', aliassen: ['De Cock'], type: 'serie', jaar: 1995 };
const lotr = { id: 5, naam: 'The Lord of the Rings', aliassen: ['Lord of the Rings'], jaar: 2001 };
const terminator2 = { id: 6, naam: 'Terminator 2', aliassen: ['T2'], jaar: 1991 };
const baantjerFilm = { id: 7, naam: 'Baantjer 2', aliassen: [], type: 'film', jaar: 2019 };

goed(flodder, { tracknaam: 'Flodder intro (1986)', artiest: 'Nederlandse TV' });
goed(gtst, { tracknaam: 'GTST intro', artiest: 'TV Tunes' });
goed(gooische, { tracknaam: 'Gooische Vrouwen titelsong', artiest: 'TV Tunes' });
fout(flodder, { tracknaam: 'Gooische Vrouwen titelsong', artiest: 'TV Tunes' });
fout({ naam: 'Pirates of the Caribbean', jaar: 2003 }, {
    tracknaam: 'Pirates of the Caribbean theme (2006)',
});
fout({ naam: 'It', jaar: 2017 }, { tracknaam: 'Little Bit of Love' });
fout(baantjer, { tracknaam: 'Baantjer 2', album: 'TV Tunes' });
fout(baantjer, { tracknaam: 'Baantjer live', album: 'TV Tunes' });
fout(baantjer, { tracknaam: 'Baantjer deel 2', album: 'TV Tunes' });
fout(gtst, { tracknaam: 'GTST live', album: 'TV Tunes' });
fout(lotr, { tracknaam: 'Lord of the Rings live', album: 'Movie Themes' });
goed(baantjer, { tracknaam: 'Baantjer intro (1995)', album: 'TV Tunes' });
goed(terminator2, { tracknaam: 'Terminator 2 theme', album: 'Judgment Day' });
goed(baantjerFilm, { tracknaam: 'Baantjer 2 soundtrack', album: 'Film' });
fout({ naam: 'Terminator', aliassen: [], jaar: 1984 }, {
    tracknaam: 'Terminator 2 theme',
    album: 'Judgment Day',
});

assert.equal(
    matchTitel('Flodder intro (1986)', [flodder, gtst, gooische]).titel.naam,
    'Flodder',
);
assert.equal(
    matchTitel('GTST intro', [flodder, gtst, gooische]).titel.naam,
    'Goede Tijden Slechte Tijden',
);
assert.equal(matchTitel('onbekende muziek', [flodder, gtst, gooische]), null);
assert.equal(matchTitel('Baantjer 2', [baantjer]), null);
assert.equal(matchTitel('Baantjer live', [baantjer]), null);
assert.equal(matchTitel('Baantjer deel 2', [baantjer]), null);
assert.equal(matchTitel('Baantjer intro', [baantjer]).titel.naam, 'Baantjer');

const youtubeKeuze = kiesBeste([
    { videoId: 'wrong-number', titel: 'Baantjer 2 intro', kanaal: 'TV Tunes', duurSeconden: 80, views: 900000 },
    { videoId: 'wrong-live', titel: 'Baantjer live', kanaal: 'TV Tunes', duurSeconden: 80, views: 900000 },
    { videoId: 'wrong-song', titel: 'Baantjer random song', kanaal: 'TV Tunes', duurSeconden: 80, views: 999999 },
    { videoId: 'right', titel: 'Baantjer intro', kanaal: 'TV Tunes', duurSeconden: 80, views: 10 },
], baantjer);
assert.equal(youtubeKeuze.videoId, 'right');

console.log('trackcheck: alle tests geslaagd');
