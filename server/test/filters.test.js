const assert = require('assert');
const { bouwFilter } = require('../game/filters');

const disney = bouwFilter({
    categorie: 'films',
    collecties: ['disney', 'pixar'],
    periode_start: 1950,
    periode_eind: 2026,
    alleen_nl_tv: false,
});

assert(disney.where.includes("COALESCE(t.categorie, t.type::text) = ANY($1::text[])"), 'filmfilter ontbreekt');
assert.deepStrictEqual(disney.params[0], ['film']);
assert(disney.where.includes("t.anime_breed_bekend = true"), 'breed bekende anime mag in filmquiz');
assert(disney.where.includes('titel_collecties'), 'collectiefilter ontbreekt');
assert(disney.where.includes('ANY($3::text[])'), 'meerdere collecties moeten OR-matchen');
assert.deepStrictEqual(disney.params[2], ['disney', 'pixar']);

const muziek = bouwFilter({
    categorie: 'muziek',
    collectie: 'rock',
    periode_start: 1950,
    periode_eind: 2026,
});
// Muziekcollectie (Rock): ook films/series/games met een passend nummer (Rocky).
assert(muziek.params[0].includes('film') && muziek.params[0].includes('muziek'), 'muziekcollectie kijkt naar het nummer');
const muziekLos = bouwFilter({ categorie: 'muziek', periode_start: 1950, periode_eind: 2026 });
assert.deepStrictEqual(muziekLos.params[0], ['muziek', 'kerst', 'kinder'], 'muziek omvat kerst en kinder, geen games');
assert(muziek.where.includes('c.sleutel = ANY($2::text[])'), 'enkele collectie ontbreekt');

const standaard = bouwFilter({ categorie: 'beide', periode_start: 1950, periode_eind: 2026 });
assert.deepStrictEqual(standaard.params[0], ['film', 'serie'], 'standaardspel mag geen muziek bevatten');

const anime = bouwFilter({ categorieen: ['anime'], periode_start: 1950, periode_eind: 2026 });
assert.deepStrictEqual(anime.params[0], ['anime']);
assert(!anime.where.includes('anime_breed_bekend'), 'animequiz pakt alle anime');

const games = bouwFilter({ categorie: 'games', game_only: true, categorieen: ['muziek'], platformen: ['sega'] });
assert.deepStrictEqual(games.params[0], ['game'], 'games filteren op categorie game');
assert(games.where.includes('lower(platform.naam) = ANY($2::text[])'), 'platformfilter moet een bindparameter gebruiken');

const tiers = bouwFilter({ categorieen: ['film'], tiers: ['iconisch', 'cult', 'onzin'] });
assert(tiers.where.includes("COALESCE(t.bekendheid_tier, 'bekend') = ANY"), 'bekendheidsfilter ontbreekt');
assert(tiers.params.some((p) => Array.isArray(p) && p.join() === 'iconisch,cult'));

const meerdere = bouwFilter({ categorieen: ['film', 'serie'], periode_start: 1950, periode_eind: 2026 });
assert(meerdere.where.includes('t.type::text = ANY'), 'anime-uitzondering moet enum-veilig filterbaar zijn');

const gecontroleerd = bouwFilter({ categorie: 'beide', alleen_gecontroleerd: true, periode_start: 1950, periode_eind: 2026 });
assert(gecontroleerd.where.includes("vc.review_status, 'open') = 'goedgekeurd'"), 'reviewstatus ontbreekt');
assert(gecontroleerd.where.includes('vc.review_handmatig = true'), 'handmatig goedgekeurde tracks ontbreken');

const kind = bouwFilter({ categorie: 'beide', kindvriendelijk: true, periode_start: 1950, periode_eind: 2026 });
assert(kind.where.includes('t.leeftijdsgrens <= 12'), 'kindmodus moet leeftijd begrenzen');
assert(kind.where.includes("c.sleutel IN ('kids', 'disney', 'pixar')"), 'kindmodus moet kindercollecties herkennen');

// Regressie: jaartalfilters moeten parameter-placeholders gebruiken, nooit
// literal '1::integer' / '2::integer' met ongebruikte queryparameters.
const jaren = bouwFilter({ categorieen: ['film', 'serie'], periode_start: 1930, periode_eind: 2026, alleen_lokaal: true });
assert(jaren.where.includes('t.jaar BETWEEN $3::integer AND $4::integer'),
    'jaartalfilter moet $3 en $4 als SQL-bindparameters gebruiken');
assert(jaren.where.includes('$3::integer <= 1930'),
    'onbekende jaartallen moeten correcte SQL-bindparameters gebruiken');
assert.deepStrictEqual(jaren.params, [['film', 'serie'], ['film', 'serie'], 1930, 2026]);

console.log('filters: film/serie/muziek, spelcollecties en kindmodus geslaagd');
