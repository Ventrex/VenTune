// Beheer 2.0: pure controles op de AI-curator en versie-onafhankelijk raden.
const assert = require('assert');
const { vergelijk, basisNaam, franchiseSleutel } = require('../lib/match');
const bankAi = require('../lib/bank-ai');
const { videoIdUit } = require('../lib/bank-mp3');
const { typeVoorCategorie } = require('../lib/bank');

// Versie-onafhankelijk raden
assert.strictEqual(vergelijk('Terminator', { naam: 'Terminator 2: Judgment Day', categorie: 'film' }).status, 'goed');
assert.strictEqual(vergelijk('Terminator 2', { naam: 'The Terminator', categorie: 'film' }).status, 'goed');
assert.strictEqual(vergelijk('Super Mario', { naam: 'Super Mario Bros. 3', categorie: 'game' }).status, 'goed');
assert.strictEqual(vergelijk('Harry Potter', { naam: 'Harry Potter and the Chamber of Secrets', categorie: 'film', franchise: 'Harry Potter' }).status, 'goed');
assert.strictEqual(vergelijk('Star', { naam: 'Star Wars', categorie: 'film' }).status, 'fout');
assert.notStrictEqual(vergelijk('Mambo', { naam: 'Mambo No. 5', categorie: 'muziek' }).status, 'goed', 'muziek blijft versiegebonden');
assert.strictEqual(basisNaam('Mission: Impossible'), 'Mission: Impossible');
assert.strictEqual(basisNaam('Rocky IV'), 'Rocky');
assert.strictEqual(basisNaam('Final Fantasy VII'), 'Final Fantasy');
assert.strictEqual(franchiseSleutel({ naam: 'Toy Story 3', categorie: 'film' }), franchiseSleutel({ naam: 'Toy Story', categorie: 'film' }));

// AI-beoordeling wordt opgeschoond
const b = bankAi.schoonBeoordeling({
    naam: 'Pokémon', categorie: 'anime', anime_breed_bekend: true, bekendheid: 'iconisch', nl_bekend: 'ja',
    nl_reden: 'Fox Kids', jaar: 3000, franchise: 'Pokémon', aliassen: ['Pokemon', 'Pokémon', ''],
    nummer_naam: 'Pokémon Theme', nummer_artiest: 'Jason Paige', yt_zoekterm: 'pokemon theme', geschikt: true, notitie: '',
});
assert.strictEqual(b.jaar, null, 'onmogelijk jaartal wordt leeg');
assert.strictEqual(b.franchise, '', 'franchise gelijk aan naam is overbodig');
assert.deepStrictEqual(b.aliassen, [], 'alias gelijk aan naam vervalt');
assert.strictEqual(bankAi.schoonBeoordeling({ categorie: 'onzin', bekendheid: 'x' }).categorie, null);

// Hints mogen het antwoord niet noemen; vragen hebben 6 opties
const q = bankAi.schoonQuiz({
    hints: ['Speelt in Amsterdam', 'De titel is Flodder', 'Familie in een villawijk'],
    vragen: [{ vraag: 'Waar?', juist: 'Zonnedael', fout: ['A', 'B', 'C', 'D', 'E'] }, { vraag: 'Te kort', juist: 'x', fout: ['a'] }],
}, { naam: 'Flodder', aliassen: [] });
assert.deepStrictEqual(q.hints, ['Speelt in Amsterdam', 'Familie in een villawijk']);
assert.strictEqual(q.vragen.length, 1);
const o = bankAi.maakOpties(q.vragen[0]);
assert.strictEqual(o.opties.length, 6);
assert.strictEqual(o.opties[o.correct_index], 'Zonnedael');

// YouTube-links en types
assert.strictEqual(videoIdUit('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.strictEqual(videoIdUit('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
assert.strictEqual(videoIdUit('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.strictEqual(videoIdUit('geen link'), null);
assert.strictEqual(typeVoorCategorie('anime', 'film'), 'film');
assert.strictEqual(typeVoorCategorie('game', 'film'), 'muziek');

console.log('bank: versie-onafhankelijk raden, AI-opschoning en MP3-links geslaagd');
