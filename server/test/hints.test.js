const assert = require('assert/strict');
const { beginLetters, bouwHinten } = require('../game/engine');

assert.equal(beginLetters('Sliders'), 'S.....s');

const hints = bouwHinten({
    naam: 'Sliders',
    type: 'serie',
    jaar: 1995,
    land: 'VS',
    genres: ['Sciencefiction', 'Avontuur'],
    hoofdrollen: ['Jerry O\'Connell', 'Sabrina Lloyd'],
    speelplek: 'parallelle werelden',
});

assert.equal(hints[0].type, 'hoofdrollen');
assert.equal(hints[1].type, 'speelplek');
assert.equal(hints[2].type, 'kenmerken');
assert.match(hints[3].tekst, /S\.\.\.\.\.s/);
assert.equal(hints[4].type, 'jaar');

console.log('hints: hints zijn titelgericht en niet meer altijd het jaartal');
