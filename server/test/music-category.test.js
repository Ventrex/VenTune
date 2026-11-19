const test = require('node:test');
const assert = require('node:assert/strict');
const { categoriseerMuziek } = require('../lib/music-category');

test('Sinterklaas is not generic children music', () => {
  const s = categoriseerMuziek({ naam: 'Zie ginds komt de stoomboot', categorie:'kinder', genres:['Kinderlied'] });
  assert.equal(s.categorie, 'sinterklaas');
  assert.deepEqual(s.genres, ['Sinterklaas','Kinderlied']);
  assert.equal(s.collectie, 'sinterklaas');
});
test('Christmas is kept apart from Sinterklaas', () => {
  const c = categoriseerMuziek({ naam: 'Last Christmas', artiest:'Wham!', genres:['Pop'] });
  assert.equal(c.categorie, 'kerst');
  assert.deepEqual(c.genres, ['Kerst','Pop']);
  assert.equal(c.collectie, 'kerst');
});
test('genres for other popular music stay independent', () => {
  assert.deepEqual(categoriseerMuziek({ naam:'Billie Jean', artiest:'Michael Jackson', genres:['Pop'] }),
    { categorie:'muziek', genres:['Pop'], collectie:null });
  assert.equal(categoriseerMuziek({ naam:'Wonderwall', genres:['Rock'] }).categorie, 'muziek');
});
test('film/game title alone must not be passed into music classification', () => {
  assert.equal(categoriseerMuziek({ naam:'Sinterklaas kapoentje', categorie:'sinterklaas' }).categorie, 'sinterklaas');
  assert.equal(categoriseerMuziek({ naam:'Een kinderlied', categorie:'kinder' }).categorie, 'kinder');
});
test('holiday metadata cannot classify a non Christmas tune by itself', () => {
  assert.equal(categoriseerMuziek({ naam:'Halloween Party', genres:['Holiday'] }).categorie, 'muziek');
});
