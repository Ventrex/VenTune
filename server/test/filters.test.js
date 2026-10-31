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

// Regressie: jaartalfilters moeten parameter-placeholders gebruiken, nooit
// literal '1::integer' / '2::integer' met ongebruikte queryparameters.
const jaren = bouwFilter({ categorieen: ['film', 'serie'], periode_start: 1930, periode_eind: 2026, alleen_lokaal: true });
assert(jaren.where.includes('t.jaar BETWEEN $2::integer AND $3::integer'),
    'jaartalfilter moet $2 en $3 als SQL-bindparameters gebruiken');
assert(jaren.where.includes('$2::integer <= 1930'),
    'onbekende jaartallen moeten correcte SQL-bindparameters gebruiken');
assert.deepStrictEqual(jaren.params, [['film', 'serie'], 1930, 2026]);

console.log('filters: film/serie/muziek, spelcollecties en kindmodus geslaagd');
