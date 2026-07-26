const assert = require('assert');
const { bouwFilter } = require('../game/filters');

const disney = bouwFilter({
    categorie: 'films',
    collecties: ['disney', 'pixar'],
    periode_start: 1950,
    periode_eind: 2026,
    alleen_nl_tv: false,
});

assert(disney.where.includes("t.type = $1"), 'filmfilter ontbreekt');
assert(disney.where.includes('titel_collecties'), 'collectiefilter ontbreekt');
assert(disney.where.includes('ANY($2::text[])'), 'meerdere collecties moeten OR-matchen');
assert.deepStrictEqual(disney.params[1], ['disney', 'pixar']);

const muziek = bouwFilter({
    categorie: 'muziek',
    collectie: 'rock',
    periode_start: 1950,
    periode_eind: 2026,
});
assert(muziek.where.includes("t.type = $1"), 'muziekfilter ontbreekt');
assert(muziek.where.includes('c.sleutel = ANY($2::text[])'), 'enkele collectie ontbreekt');

const standaard = bouwFilter({ categorie: 'beide', periode_start: 1950, periode_eind: 2026 });
assert(standaard.where.includes("t.type IN ('film', 'serie')"), 'standaardspel mag geen muziek bevatten');

const meerdere = bouwFilter({ categorieen: ['film', 'serie'], periode_start: 1950, periode_eind: 2026 });
assert(meerdere.where.includes('t.type = ANY'), 'meerdere inhoudstypen moeten expliciet filterbaar zijn');

console.log('filters: film/serie/muziek en spelcollecties geslaagd');
