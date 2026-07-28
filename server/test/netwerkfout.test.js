// =====================================================================
// Test: een onbereikbaar YouTube mag geen titels afkeuren.
//
// "fetch failed" zegt niets over de titel. Zonder onderscheid raakte een
// netwerkstoring honderden goede titels kwijt in de vastgelopen-lijst.
// =====================================================================

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';

const cache = require('../lib/cache');
cache.lees = async () => null;
cache.schrijf = async () => {};
cache.noteerZoekopdracht = async () => {};

const ytzoek = require('../lib/ytzoek');

let mislukt = 0;
function check(naam, waar, extra) {
    if (!waar) {
        mislukt++;
        console.error(`FOUT: ${naam}${extra ? ` → ${extra}` : ''}`);
    }
}

async function main() {
    // 1. Netwerkfout: opnieuw proberen, en de fout is als netwerk gemarkeerd.
    let pogingen = 0;
    global.fetch = async () => {
        pogingen++;
        throw new TypeError('fetch failed');
    };
    let fout = null;
    try {
        await ytzoek.zoek('Flodder intro');
    } catch (err) {
        fout = err;
    }
    check('een netwerkfout wordt opnieuw geprobeerd', pogingen > 1, `${pogingen} poging(en)`);
    check('de fout is gemarkeerd als netwerkprobleem', fout && fout.netwerk === true, String(fout));
    check(
        'de melding noemt de oorzaak',
        fout && /niet bereikbaar/i.test(fout.message),
        fout && fout.message,
    );

    // 2. Netwerk hersteld na één hik: dan gewoon resultaten.
    let n = 0;
    global.fetch = async () => {
        n++;
        if (n === 1) throw new TypeError('fetch failed');
        return { ok: true, status: 200, text: async () => '<html></html>' };
    };
    let uit = null;
    try {
        uit = await ytzoek.zoek('Flodder intro 2');
    } catch (err) {
        check('herstel na één hik levert geen fout', false, err.message);
    }
    check('na herstel komt er gewoon een resultaat', Array.isArray(uit), JSON.stringify(uit));

    // 3. Een echte 404 is géén netwerkfout: die titel mag wél afgestraft.
    global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
    let fout404 = null;
    try {
        await ytzoek.zoek('Bestaat Niet');
    } catch (err) {
        fout404 = err;
    }
    check('een 404 telt niet als netwerkprobleem', fout404 && fout404.netwerk === false, String(fout404?.netwerk));

    if (mislukt > 0) {
        console.error(`netwerkfout: ${mislukt} test(s) mislukt`);
        process.exit(1);
    }
    console.log('netwerkfout: storingen keuren geen titels meer af');
}

main().catch((err) => {
    console.error('netwerkfout: test mislukt', err);
    process.exit(1);
});
