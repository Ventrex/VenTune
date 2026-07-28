// =====================================================================
// Test voor de soundtrack-route: welk nummer hoort bij welke titel?
//
// Alle externe aanroepen (iTunes, Wikipedia) worden nagebootst, zodat de
// test zonder netwerk en zonder database draait.
// =====================================================================

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';

const cache = require('../lib/cache');
// Geen database in deze test: de cache doet niets.
cache.lees = async () => null;
cache.schrijf = async () => {};

const soundtrack = require('../lib/soundtrack');
const ytzoek = require('../lib/ytzoek');
const { pastBijTitel } = require('../lib/trackcheck');

let mislukt = 0;

function check(naam, waar, extra) {
    if (!waar) {
        mislukt++;
        console.error(`FOUT: ${naam}${extra ? ` → ${extra}` : ''}`);
    }
}

function wikiAntwoord(tekst) {
    return { ok: true, json: async () => ({ query: { pages: { 1: { extract: tekst } } } }) };
}

// ---------------------------------------------------------------------
// kiesUitAlbum — welk nummer van de soundtrack is het herkenbaarst?
// ---------------------------------------------------------------------
function testKiesUitAlbum() {
    const coco = [
        { tracknaam: 'You Be You', nummer: 1 },
        { tracknaam: 'Coco Score Suite', nummer: 2 },
        { tracknaam: 'Regen', nummer: 3 },
    ];
    check(
        'titelsong wint van score-suite',
        soundtrack.kiesUitAlbum(coco, { naam: '100% Coco' })?.tracknaam === 'You Be You',
    );

    const gooische = [
        { tracknaam: 'Liefde Is Een Kaartspel', nummer: 1 },
        { tracknaam: 'Gooische Vrouwen (Main Title)', nummer: 7 },
        { tracknaam: 'Shopping Montage', nummer: 8 },
    ];
    check(
        'nummer met de titelnaam wint van nummer 1',
        soundtrack.kiesUitAlbum(gooische, { naam: 'Gooische Vrouwen' })?.tracknaam ===
            'Gooische Vrouwen (Main Title)',
    );

    const flodder = [
        { tracknaam: 'Opening Titles', nummer: 1 },
        { tracknaam: 'Chase (Orchestral)', nummer: 2 },
    ];
    check(
        'opening titles wint van orchestral',
        soundtrack.kiesUitAlbum(flodder, { naam: 'Flodder' })?.tracknaam === 'Opening Titles',
    );

    check('leeg album geeft null', soundtrack.kiesUitAlbum([], { naam: 'X' }) === null);
    check('geen album geeft null', soundtrack.kiesUitAlbum(null, { naam: 'X' }) === null);
}

// ---------------------------------------------------------------------
// Wikipedia — de naam van de titelsong uit de lopende tekst halen
// ---------------------------------------------------------------------
async function testWikipedia() {
    const gevallen = [
        {
            naam: '100% Coco',
            tekst:
                '100% Coco is een Nederlandse jeugdfilm uit 2017. De titelsong van de ' +
                'film is "You Be You", gezongen door Dionne Slagter.',
            verwacht: 'You Be You',
        },
        {
            naam: 'Het Gouden Uur',
            tekst: 'Het Gouden Uur is een dramaserie. Het titelnummer is "Ademloos".',
            verwacht: 'Ademloos',
        },
        {
            // Een apostrof in de songtitel mag de match niet afbreken.
            naam: 'Friends',
            tekst:
                'Friends is an American sitcom. The theme song is titled ' +
                '"I\'ll Be There for You" by The Rembrandts.',
            verwacht: "I'll Be There for You",
        },
        {
            naam: 'Flodder',
            tekst: 'Flodder is een Nederlandse film uit 1986 van Dick Maas.',
            verwacht: null,
        },
    ];

    for (const geval of gevallen) {
        global.fetch = async () => wikiAntwoord(geval.tekst);
        const uit = await soundtrack.songNaamViaWikipedia({ naam: geval.naam, taal: 'nl' });
        check(`wikipedia ${geval.naam}`, uit === geval.verwacht, String(uit));
    }

    global.fetch = async () => {
        throw new Error('geen netwerk');
    };
    check(
        'netwerkfout geeft null zonder crash',
        (await soundtrack.songNaamViaWikipedia({ naam: 'Iets', taal: 'nl' })) === null,
    );
}

// ---------------------------------------------------------------------
// zoekAlbums — alleen albums die naar de titel heten tellen mee
// ---------------------------------------------------------------------
async function testAlbums() {
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            results: [
                {
                    collectionId: 1,
                    collectionName: '100% Coco (Original Soundtrack)',
                    artistName: 'Various',
                    releaseDate: '2017-02-01T00:00:00Z',
                    trackCount: 12,
                },
                {
                    collectionId: 2,
                    collectionName: 'Frozen (Original Motion Picture Soundtrack)',
                    artistName: 'Various',
                    releaseDate: '2013-11-25T00:00:00Z',
                    trackCount: 30,
                },
            ],
        }),
    });

    const albums = await soundtrack.zoekAlbums({ naam: '100% Coco', jaar: 2017 });
    check('alleen het eigen album blijft over', albums.length === 1, JSON.stringify(albums));
    check('en dat is het juiste album', albums[0]?.collectionId === 1);

    const geen = await soundtrack.zoekAlbums({ naam: 'Het Gouden Uur', jaar: 2021 });
    check('een vreemd album wordt geweigerd', geen.length === 0, JSON.stringify(geen));
}

// ---------------------------------------------------------------------
// De volledige route
// ---------------------------------------------------------------------
async function testVolledigeRoute() {
    global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/search') && u.includes('entity=album')) {
            return {
                ok: true,
                json: async () => ({
                    results: [
                        {
                            collectionId: 1,
                            collectionName: '100% Coco (Original Soundtrack)',
                            artistName: 'Various',
                            releaseDate: '2017-02-01T00:00:00Z',
                            trackCount: 12,
                        },
                    ],
                }),
            };
        }
        if (u.includes('/lookup')) {
            return {
                ok: true,
                json: async () => ({
                    results: [
                        { wrapperType: 'collection' },
                        {
                            wrapperType: 'track',
                            trackId: 5,
                            trackName: 'You Be You',
                            artistName: 'Dionne Slagter',
                            collectionName: '100% Coco (Original Soundtrack)',
                            previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a',
                            trackNumber: 1,
                        },
                        {
                            wrapperType: 'track',
                            trackId: 6,
                            trackName: 'Coco Suite',
                            artistName: 'Score',
                            collectionName: '100% Coco (Original Soundtrack)',
                            previewUrl: 'https://audio-ssl.itunes.apple.com/z.m4a',
                            trackNumber: 2,
                        },
                    ],
                }),
            };
        }
        throw new Error(`onverwachte url ${u}`);
    };

    const uit = await soundtrack.zoekVoorTitel({ naam: '100% Coco', jaar: 2017, taal: 'nl' });
    check('album-route vindt de titelsong', uit?.tracknaam === 'You Be You', JSON.stringify(uit));
    check('herkomst is het album', uit?.via === 'album', uit?.via);

    // Geen album, wel een titelsong in de Wikipedia-tekst.
    global.fetch = async (url) => {
        if (String(url).includes('wikipedia.org')) {
            return wikiAntwoord('De titelsong van de serie is "Kom Maar Op".');
        }
        return { ok: true, json: async () => ({ results: [] }) };
    };
    const uit2 = await soundtrack.zoekVoorTitel({ naam: 'Onbekende Serie', taal: 'nl' });
    check(
        'zonder album blijft de songnaam over',
        uit2?.alleenSongnaam === 'Kom Maar Op',
        JSON.stringify(uit2),
    );

    global.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
    check(
        'niets gevonden geeft null',
        (await soundtrack.zoekVoorTitel({ naam: 'Niets Hier', taal: 'nl' })) === null,
    );
}

// ---------------------------------------------------------------------
// De songnaam maakt de YouTube-zoekopdracht gericht
// ---------------------------------------------------------------------
function testYoutubeMetSongnaam() {
    const termen = ytzoek.zoektermenVoor(
        { naam: '100% Coco', type: 'film', taal: 'nl', jaar: 2017 },
        { songnaam: 'You Be You' },
    );
    check('de titelsong staat vooraan', termen[0] === 'You Be You 100% Coco', termen[0]);
    check(
        'de gewone zoektermen blijven bestaan',
        termen.includes('100% Coco 2017 main theme'),
        termen.join(' | '),
    );

    const zonder = ytzoek.zoektermenVoor({ naam: 'Sliders', type: 'serie', taal: 'en' });
    check('zonder songnaam verandert er niets', zonder[0] === 'Sliders intro', zonder[0]);

    const videos = [
        {
            titel: 'You Be You - Dionne Slagter (Official Video)',
            kanaal: 'Dionne Slagter',
            views: 500000,
            duurSeconden: 200,
        },
        { titel: 'Willekeurig liedje', kanaal: 'Iemand', views: 9000000, duurSeconden: 200 },
    ];
    const titel = { naam: '100% Coco', type: 'film', jaar: 2017 };
    check(
        'zonder songnaam is niets bruikbaar',
        ytzoek.kiesBeste(videos, titel) === null,
    );
    const met = ytzoek.kiesBeste(videos, titel, { songnaam: 'You Be You' });
    check(
        'met songnaam wint de juiste video van de populairdere',
        met?.titel.startsWith('You Be You'),
        met?.titel,
    );
    check('en die is als bevestigd gemarkeerd', met?._viaSong === true);
    check(
        'een te korte songnaam telt niet mee',
        ytzoek.kiesBeste(videos, titel, { songnaam: 'yo' }) === null,
    );
}

// ---------------------------------------------------------------------
// De bevestigde koppeling in trackcheck
// ---------------------------------------------------------------------
function testBevestigd() {
    const titel = { naam: '100% Coco', jaar: 2017 };
    const track = { tracknaam: 'You Be You', artiest: 'Dionne Slagter' };
    check('zonder bewijs wordt de track geweigerd', !pastBijTitel(titel, track).past);
    check(
        'met bevestiging wordt dezelfde track geaccepteerd',
        pastBijTitel(titel, { ...track, bevestigd: true }).past,
    );
    check(
        'bevestigd = false verandert niets',
        !pastBijTitel(titel, { ...track, bevestigd: false }).past,
    );
    check(
        'een gewone treffer blijft werken',
        pastBijTitel({ naam: 'Flodder' }, { tracknaam: 'Flodder intro' }).past,
    );
}

async function main() {
    testKiesUitAlbum();
    await testWikipedia();
    await testAlbums();
    await testVolledigeRoute();
    testYoutubeMetSongnaam();
    testBevestigd();

    if (mislukt > 0) {
        console.error(`soundtrack: ${mislukt} test(s) mislukt`);
        process.exit(1);
    }
    console.log('soundtrack: titelsong-route en bevestigde koppelingen geslaagd');
}

main().catch((err) => {
    console.error('soundtrack: test mislukt', err);
    process.exit(1);
});
