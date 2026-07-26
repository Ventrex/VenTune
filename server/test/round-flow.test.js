const assert = require('assert/strict');
const { pool } = require('../db/pool');
const {
    SpelBeheer,
    verwijderOnspeelbareTitel,
    bouwMeerkeuzeOpties,
    lifelineAantal,
} = require('../game/engine');

// Een onbruikbare titel op positie 3 mag niet maken dat de volgende titel
// als ronde 4 wordt gepubliceerd. De titel wordt verwijderd, het rondenummer
// gaat één terug en de volgende overgang verhoogt het weer naar 3.
const state = {
    pool: [{ naam: '1' }, { naam: '2' }, { naam: '3' }, { naam: '4' }],
    rondenummer: 3,
    totaalRondes: 4,
};

assert.equal(verwijderOnspeelbareTitel(state), true);
assert.deepEqual(state.pool.map((titel) => titel.naam), ['1', '2', '4']);
assert.equal(state.rondenummer, 2);
assert.equal(state.totaalRondes, 3);

state.rondenummer += 1;
assert.equal(state.rondenummer, 3);
assert.equal(state.pool[state.rondenummer - 1].naam, '4');

// Als de laatste geplande titel onbruikbaar is, moet het spel netjes eindigen
// in plaats van nog een extra overgang te plannen.
const laatste = {
    pool: [{ naam: '1' }, { naam: '2' }],
    rondenummer: 2,
    totaalRondes: 2,
};
assert.equal(verwijderOnspeelbareTitel(laatste), false);
assert.equal(laatste.pool.length, 1);
assert.equal(laatste.rondenummer, 1);

assert.equal(lifelineAantal({ rondes: 10 }), 1);
assert.equal(lifelineAantal({ rondes: 20 }), 2);
assert.equal(lifelineAantal({ rondes: 0 }), 3);

const meerkeuze = bouwMeerkeuzeOpties(
    { id: 1, naam: 'Terminator 2', jaar: 1991 },
    [
        { id: 1, naam: 'Terminator 2', jaar: 1991 },
        { id: 2, naam: 'Jurassic Park', jaar: 1993 },
        { id: 3, naam: 'Titanic', jaar: 1997 },
        { id: 4, naam: 'The Matrix', jaar: 1999 },
        { id: 5, naam: 'Friends', jaar: 1994 },
        { id: 6, naam: 'Pulp Fiction', jaar: 1994 },
        { id: 7, naam: 'Se7en', jaar: 1995 },
    ],
);
assert.equal(meerkeuze.opties.length, 6);
assert.equal(meerkeuze.opties[meerkeuze.correctIndex], 'Terminator 2');

async function testDubbeleScorebordOvergang() {
    const emits = [];
    const io = {
        to: () => ({ emit: (event) => emits.push(event) }),
    };
    const spel = new SpelBeheer(io);
    const state = {
        lobbyId: 'lobby-1',
        code: 'TEST',
        fase: 'bonus',
        huidige: { rondeId: 99 },
        scorebordTimer: null,
        overgangVersie: 0,
    };
    spel.spellen.set(state.lobbyId, state);
    spel.haalScorebord = async () => [];

    const oorspronkelijkeQuery = pool.query;
    pool.query = async () => ({ rows: [] });
    try {
        await spel.naarScorebord(state);
        const eersteTimer = state.scorebordTimer;
        assert.ok(eersteTimer);

        // Een tweede timer/antwoord mag geen tweede overgang plannen.
        await spel.naarScorebord(state);
        assert.equal(state.scorebordTimer, eersteTimer);
        assert.equal(emits.filter((event) => event === 'ronde:afgelopen').length, 1);

        // Ook een oude hostklik in deze fase mag de rondenummering niet
        // veranderen of de automatische overgang omzeilen.
        await spel.volgende({ data: { lobbyId: state.lobbyId, isHost: true } });
        assert.equal(state.fase, 'scorebord');
    } finally {
        clearTimeout(state.scorebordTimer);
        pool.query = oorspronkelijkeQuery;
    }
}

testDubbeleScorebordOvergang()
    .then(() => console.log('round-flow: overgangen zijn enkelvoudig en stabiel'))
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
