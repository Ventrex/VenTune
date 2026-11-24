// Tests: eerlijke teamverdeling, leeftijdsweging en de rondevraag.
const assert = require('assert/strict');
const { verdeelEerlijk } = require('../game/teams');
const { leeftijdGewicht, wegingsVolgorde } = require('../game/leeftijd-weging');
const { rondeVraag } = require('../game/engine');

// ---- Teams ----
{
    const spelers = [
        { id: 'a', leeftijd: 8 }, { id: 'b', leeftijd: 10 },
        { id: 'c', leeftijd: 70 }, { id: 'd', leeftijd: 66 },
        { id: 'e', leeftijd: 40, sterkte: 900 }, { id: 'f', leeftijd: 38, sterkte: 100 },
        { id: 'g', leeftijd: 45, sterkte: 850 }, { id: 'h', leeftijd: 33, sterkte: 120 },
    ];
    for (let i = 0; i < 20; i++) {
        const { teams, indeling } = verdeelEerlijk(spelers, 2);
        assert.equal(teams.length, 2);
        const per = (filter) => teams.map((t) => spelers.filter((s) => indeling[s.id] === t && filter(s)).length);
        assert.deepEqual(per(() => true), [4, 4], 'even grote teams');
        assert.deepEqual(per((s) => s.leeftijd <= 12), [1, 1], 'kinderen verdeeld');
        assert.deepEqual(per((s) => s.leeftijd >= 60), [1, 1], 'senioren verdeeld');
        // de twee sterkste spelers zitten niet samen
        assert.notEqual(indeling.e, indeling.g, 'sterke spelers verdeeld');
    }
    const drie = verdeelEerlijk([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], 3, ['Kaas']);
    assert.equal(drie.teams[0], 'Kaas', 'bestaande naam blijft');
    const groottes = drie.teams.map((t) => Object.values(drie.indeling).filter((x) => x === t).length).sort();
    assert.deepEqual(groottes, [1, 2, 2]);
}

// ---- Leeftijdsweging ----
{
    const nu = 2026;
    const jaren80 = { jaar: 1985, categorie: 'muziek' };
    const nieuw = { jaar: 2024, categorie: 'muziek' };
    const jaren60 = { jaar: 1964, categorie: 'muziek' };
    assert.equal(leeftijdGewicht(jaren80, [], nu), 1, 'zonder leeftijden geen weging');
    assert.ok(leeftijdGewicht(jaren60, [75], nu) > leeftijdGewicht(jaren60, [30], nu), 'senior krijgt jaren 60 vaker');
    assert.ok(leeftijdGewicht(nieuw, [9], nu) > 1.5, 'kind krijgt nieuwe muziek vaker');
    assert.ok(leeftijdGewicht({ jaar: 1960, categorie: 'sinterklaas' }, [7], nu) > 1.5, 'kind kent Sinterklaasliedjes');
    // kind en senior wegen zwaarder dan een volwassene in de jeugdjaren
    assert.ok(leeftijdGewicht(jaren60, [75], nu) > leeftijdGewicht(jaren80, [50], nu));
    assert.ok(leeftijdGewicht(jaren60, [75, 30, 30], nu) <= 2.2);

    // In een grote steekproef komen jaren-60 titels bij een senior vaker vooraan.
    const titels = [];
    for (let i = 0; i < 50; i++) titels.push({ id: i, jaar: i < 25 ? 1962 : 1995 });
    let oud = 0;
    for (let r = 0; r < 300; r++) oud += wegingsVolgorde(titels, [78], () => 1, nu).slice(0, 10).filter((t) => t.jaar === 1962).length;
    assert.ok(oud / 300 > 5.5, `senior: gemiddeld meer oude titels vooraan (${(oud / 300).toFixed(2)})`);
}

// ---- Rondevraag ----
assert.match(rondeVraag({ categorie: 'film' }), /film/);
assert.match(rondeVraag({ categorie: 'sinterklaas' }), /Sinterklaas/);
assert.match(rondeVraag({ type: 'muziek' }), /nummer/);

console.log('teams-leeftijd: ok');
