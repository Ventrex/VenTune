const assert = require('node:assert/strict');
const { valideerQuizSet } = require('../lib/aanbevelingen');

function vraag(vraag, goed, rest) {
    return { vraag, opties: [goed, ...rest], correct_index: 0 };
}
const hints = [
    'Het verhaal speelt in een Amerikaans kantoor.',
    'De hoofdpersonages werken dagelijks samen.',
    'Een terugkerende leidinggevende heet Michael Scott.',
];
const vragen = [
    vraag('Wat is de naam van de stad waar de serie zich afspeelt?', 'Scranton', ['Boston', 'Tampa', 'Seattle', 'Austin', 'Denver']),
    vraag('Wie speelt het personage Jim Halpert?', 'John Krasinski', ['Steve Carell', 'David Schwimmer', 'Chris Pratt', 'Ted Danson', 'Ben Stiller']),
    vraag('Welke zender zond de serie oorspronkelijk uit?', 'NBC', ['ABC', 'CBS', 'FOX', 'HBO', 'Showtime']),
];
assert.equal(valideerQuizSet(hints, vragen), null);
const lekkendeHints = [...hints.slice(0, 2), 'De Amerikaanse stad is Scranton.'];
assert.match(valideerQuizSet(lekkendeHints, vragen), /verklapt|overlapt/);
assert.match(valideerQuizSet(hints.slice(0, 2), vragen), /drie hints/);
assert.match(valideerQuizSet([hints[0], hints[0], hints[2]], vragen), /Dubbele/);
assert.match(valideerQuizSet(hints, vragen.map(q => ({...q, opties:q.opties.slice(0,4)}))), /ongeldige/);
console.log('ai-quiz: 3 hints, 3 vragen, geen antwoordlekken, 6 keuzes');
