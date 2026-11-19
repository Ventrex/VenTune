const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseerZoekterm, sqlZoekveld } = require('../lib/search-normalize');

test('Assassins Creed matches every apostrophe variant', () => {
  for (const q of ["Assassins Creed", "Assassin's Creed", "Assassin’s Creed", "Assassin`s Creed", "Assassin´s Creed"]) {
    assert.equal(normaliseerZoekterm(q), 'assassins creed');
  }
});
test('SQL field identifiers cannot contain values or SQL snippets', () => {
  assert.match(sqlZoekveld('t.naam'), /^translate\(lower/);
  assert.throws(() => sqlZoekveld('t.naam; DELETE FROM titels'));
});
