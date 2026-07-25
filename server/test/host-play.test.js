const assert = require('assert/strict');
const { iedereenActiefKlaar } = require('../game/engine');

const host = { id: 'host', verbonden: true, is_host: true };
const gast = { id: 'gast', verbonden: true, is_host: false };
const weg = { id: 'weg', verbonden: false, is_host: false };

assert.equal(iedereenActiefKlaar([host, gast], new Set(['gast'])), false);
assert.equal(iedereenActiefKlaar([host, gast], new Set(['host', 'gast'])), true);
assert.equal(iedereenActiefKlaar([host, weg], new Set(['host'])), true);
assert.equal(iedereenActiefKlaar([], new Set()), false);

console.log('host-play: host telt mee als actieve speler');
