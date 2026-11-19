const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseerSpelUitgave, isBijzondereUitgave } = require('../lib/game-title');
test('only game special editions collapse to original base title', () => {
  assert.equal(normaliseerSpelUitgave("Assassin's Creed: Origins - Deluxe Edition"), "Assassin's Creed: Origins");
  assert.equal(normaliseerSpelUitgave('Assassin’s Creed: Origins Ultimate Edition'), 'Assassin’s Creed: Origins');
  assert.equal(normaliseerSpelUitgave('Skyrim Special Edition'), 'Skyrim');
  assert.equal(normaliseerSpelUitgave('Super Mario Odyssey'), 'Super Mario Odyssey');
  assert.equal(normaliseerSpelUitgave('Assassin’s Creed II'), 'Assassin’s Creed II');
  assert.equal(isBijzondereUitgave('The Witcher 3 - Complete Edition'), true);
});
