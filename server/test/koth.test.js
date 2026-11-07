// King of the Hill: goed omhoog, fout omlaag, wie bovenaan komt wint.
const assert = require('assert/strict');
const { pool } = require('../db/pool');
const { SpelBeheer, kothUit } = require('../game/engine');

(async () => {
    assert.equal(kothUit({ spelvorm: 'tegen_elkaar' }), null);
    assert.equal(kothUit({ spelvorm: 'bergexpeditie' }).modus, 'samen', 'oude Bergexpeditie wordt samen');
    assert.equal(kothUit({ spelvorm: 'king_of_the_hill', koth_stappen: 99 }).stappen, 10);

    const events = [];
    const spel = new SpelBeheer({ to: () => ({ emit: (e, d) => events.push([e, d]) }) });
    const oud = pool.query;
    pool.query = async () => ({ rows: [{ id: 'a', naam: 'Anna' }, { id: 'b', naam: 'Bas' }] });
    try {
        const state = { code: 'TEST', lobbyId: 1, koth: kothUit({ spelvorm: 'king_of_the_hill', koth_stappen: 5 }) };
        await spel.klimOfZak(state, { antwoorden: new Map([['a', {}]]) });
        assert.equal(state.koth.posities.a, 1);
        assert.equal(state.koth.posities.b, 0, 'nooit onder de voet');
        for (let i = 0; i < 4; i++) await spel.klimOfZak(state, { antwoorden: new Map([['a', {}]]) });
        assert.deepEqual(state.koth.winnaars, ['a']);
        assert.equal(events.at(-1)[0], 'koth:status');
        assert.equal(events.at(-1)[1].spelers[0].naam, 'Anna');

        const samen = { code: 'T', lobbyId: 1, koth: kothUit({ spelvorm: 'king_of_the_hill', koth_modus: 'samen', koth_stappen: 5 }) };
        await spel.klimOfZak(samen, { antwoorden: new Map() });
        assert.equal(samen.koth.team, 0);
        await spel.klimOfZak(samen, { antwoorden: new Map([['a', {}]]) });
        assert.equal(samen.koth.team, 1);
    } finally {
        pool.query = oud;
    }
    console.log('koth: klimmen, zakken en winnen geslaagd');
})().catch((e) => { console.error(e); process.exit(1); });
