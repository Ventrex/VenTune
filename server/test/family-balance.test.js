const test = require('node:test');
const assert = require('node:assert/strict');
const { kiesFamilieMix } = require('../game/family-balance');
const data = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1, taal: i < 6 ? 'nl' : 'en',
  nl_versie: i === 6,
  nl_bekend: 'ja', bekendheid_tier: 'iconisch',
}));
test('familie mengt ten minste een derde Nederlandstalige audio waar beschikbaar', () => {
  const mix = kiesFamilieMix(data, [], 12, 'familie');
  assert.equal(mix.gekozen.length, 12);
  assert.equal(mix.gekozen.filter(x => x.taal === 'nl' || x.nl_versie).length, 4);
  assert.equal(new Set(mix.gekozen.map(x => x.id)).size, 12);
});
test('onvoldoende Nederlandstalige voorraad valt terug zonder geforceerde duplicaten', () => {
  const mix = kiesFamilieMix(data.slice(5), [], 12, 'familie');
  assert.equal(mix.gekozen.length, 12);
  assert.equal(mix.nederlandsMinimaal, 2);
});
test('standaard doet geen aannames over voorkeur of leeftijd', () => {
  const mix = kiesFamilieMix(data, [], 10, 'standaard');
  assert.equal(mix.nederlandsMinimaal, 0);
  assert.equal(mix.gekozen.length, 10);
});
