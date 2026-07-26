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
assert(meerdere.where.includes('t.type::text = ANY'), 'meerdere inhoudstypen moeten enum-veilig filterbaar zijn');

const gecontroleerd = bouwFilter({ categorie: 'beide', alleen_gecontroleerd: true, periode_start: 1950, periode_eind: 2026 });
assert(gecontroleerd.where.includes('vc.gecontroleerd = true'), 'geverifieerde spelmodus ontbreekt');
assert(gecontroleerd.where.includes('vc.verificatie_score >= 0.85'), 'geverifieerde drempel ontbreekt');

const kind = bouwFilter({ categorie: 'beide', kindvriendelijk: true, periode_start: 1950, periode_eind: 2026 });
assert(kind.where.includes('t.leeftijdsgrens <= 12'), 'kindmodus moet leeftijd begrenzen');
assert(kind.where.includes("c.sleutel IN ('kids', 'disney', 'pixar')"), 'kindmodus moet kindercollecties herkennen');

console.log('filters: film/serie/muziek, spelcollecties en kindmodus geslaagd');
