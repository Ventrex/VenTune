// =====================================================================
// Test voor de quiz-edities.
//
// Elke quiz is een opgeslagen filter. Deze test controleert dat elk
// ingebouwd filter geldig SQL oplevert én werkelijk selecteert wat de naam
// belooft — een 80s Quiz mag geen film uit 2015 bevatten.
//
// Draait alleen met TEST_DATABASE_URL; anders wordt de test overgeslagen.
// =====================================================================

const url = process.env.TEST_DATABASE_URL;
if (!url) {
    console.log('quizzen: overgeslagen (TEST_DATABASE_URL ontbreekt)');
    process.exit(0);
}
process.env.DATABASE_URL = url;

const { pool } = require('../db/pool');
const { bouwFilter } = require('../game/filters');

let mislukt = 0;
function check(naam, waar, extra) {
    if (!waar) {
        mislukt++;
        console.error(`FOUT: ${naam}${extra ? ` → ${extra}` : ''}`);
    }
}

async function selecteer(filter) {
    const { where, params } = bouwFilter(filter);
    const { rows } = await pool.query(
        `SELECT t.naam FROM titels t ${where} ORDER BY t.naam`,
        params,
    );
    return rows.map((r) => r.naam);
}

async function main() {
    await pool.query(`DELETE FROM titels WHERE naam LIKE 'QuizTest%'`);

    // Een kleine, voorspelbare catalogus.
    const catalogus = [
        // naam, type, taal, jaar, genres, leeftijd
        ['QuizTest Film 80', 'film', 'en', 1985, ['Actie'], 12],
        ['QuizTest Film 90', 'film', 'en', 1995, ['Komedie'], 12],
        ['QuizTest Film NU', 'film', 'en', 2023, ['Drama'], 16],
        ['QuizTest Serie 90', 'serie', 'en', 1996, ['Komedie'], 12],
        ['QuizTest NL Film', 'film', 'nl', 1988, ['Komedie'], 12],
        ['QuizTest NL Serie', 'serie', 'nl', 2005, ['Drama'], 12],
        ['QuizTest NL Muziek', 'muziek', 'nl', 1999, [], 6],
        ['QuizTest Tekenfilm', 'film', 'en', 1994, ['Animatie'], 6],
    ];
    const ids = {};
    for (const [naam, type, taal, jaar, genres, leeftijd] of catalogus) {
        const { rows } = await pool.query(
            `INSERT INTO titels (naam, aliassen, type, taal, jaar, genres, leeftijdsgrens)
             VALUES ($1, '{}', $2, $3, $4, $5, $6) RETURNING id`,
            [naam, type, taal, jaar, genres, leeftijd],
        );
        ids[naam] = rows[0].id;
    }

    function alleenTest(namen) {
        return namen.filter((n) => n.startsWith('QuizTest'));
    }

    // Alle ingebouwde quizzen moeten geldige SQL opleveren.
    const { rows: quizzen } = await pool.query(
        `SELECT sleutel, naam, filter FROM quizzen WHERE ingebouwd = true ORDER BY volgorde`,
    );
    check('er zijn ingebouwde quizzen', quizzen.length >= 20, String(quizzen.length));
    for (const quiz of quizzen) {
        try {
            await selecteer({ ...quiz.filter, alleen_lokaal: true });
        } catch (err) {
            check(`filter van "${quiz.naam}" draait`, false, err.message);
        }
    }

    function filterVan(sleutel) {
        const quiz = quizzen.find((q) => q.sleutel === sleutel);
        if (!quiz) {
            mislukt++;
            console.error(`FOUT: quiz "${sleutel}" ontbreekt`);
            return {};
        }
        return quiz.filter;
    }

    // 80s pakt alleen de jaren 80.
    const tachtig = alleenTest(await selecteer(filterVan('80s')));
    check(
        '80s Quiz pakt alleen jaren 80',
        tachtig.length === 2 && tachtig.every((n) => n.includes('80') || n.includes('NL Film')),
        tachtig.join(', '),
    );

    // 90s pakt alleen de jaren 90, inclusief series.
    const negentig = alleenTest(await selecteer(filterVan('90s')));
    check(
        '90s Quiz pakt film, serie én muziek uit de jaren 90',
        negentig.length === 4,
        negentig.join(', '),
    );

    // Serie Quiz pakt geen films.
    const series = alleenTest(await selecteer(filterVan('serie')));
    check(
        'Serie Quiz pakt alleen series',
        series.length === 2 && series.every((n) => n.includes('Serie')),
        series.join(', '),
    );

    // Nederland Quiz pakt geen Engelse titels en geen losse muziek.
    const nederland = alleenTest(await selecteer(filterVan('nederland')));
    check(
        'Nederland Quiz pakt alleen Nederlandse films en series',
        nederland.length === 2 && nederland.every((n) => n.includes('NL')),
        nederland.join(', '),
    );

    // 100% NL Muziek pakt alleen muziek.
    const nlMuziek = alleenTest(await selecteer(filterVan('nl-muziek')));
    check(
        '100% NL Muziek pakt alleen Nederlandse muziek',
        nlMuziek.length === 1 && nlMuziek[0] === 'QuizTest NL Muziek',
        nlMuziek.join(', '),
    );

    // Comedy pakt op genre, niet op type.
    const comedy = alleenTest(await selecteer(filterVan('comedy')));
    check(
        'Comedy Quiz pakt op genre',
        comedy.length === 3 && comedy.every((n) => !n.includes('Film 80')),
        comedy.join(', '),
    );

    // Actie pakt alleen de actiefilm.
    const actie = alleenTest(await selecteer(filterVan('actie')));
    check('Actie Quiz pakt alleen actie', actie.length === 1, actie.join(', '));

    // Tekenfilm pakt op animatiegenre.
    const tekenfilm = alleenTest(await selecteer(filterVan('animatie')));
    check('Tekenfilm Quiz pakt animatie', tekenfilm.length === 1, tekenfilm.join(', '));

    // Kinder Quiz laat 16+ buiten.
    const kids = alleenTest(await selecteer(filterVan('kids')));
    check(
        'Kinder Quiz laat 16+ buiten',
        !kids.includes('QuizTest Film NU'),
        kids.join(', '),
    );

    // Alles Door Elkaar pakt ook muziek.
    const alles = alleenTest(await selecteer(filterVan('alles')));
    check(
        'Alles Door Elkaar pakt ook muziek',
        alles.includes('QuizTest NL Muziek') && alles.length === catalogus.length,
        alles.join(', '),
    );

    // Film & Serie pakt juist géén muziek.
    const filmSerie = alleenTest(await selecteer(filterVan('film-serie')));
    check(
        'Film & Serie Quiz pakt geen muziek',
        !filmSerie.includes('QuizTest NL Muziek'),
        filmSerie.join(', '),
    );

    // Een collectie-quiz zonder gekoppelde titels levert niets op, en dat
    // mag geen fout zijn.
    const kerst = alleenTest(await selecteer(filterVan('kerst')));
    check('Kerst Quiz is leeg zonder gekoppelde titels', kerst.length === 0, kerst.join(', '));

    await pool.query(`DELETE FROM titels WHERE naam LIKE 'QuizTest%'`);
    await pool.end();

    if (mislukt > 0) {
        console.error(`quizzen: ${mislukt} test(s) mislukt`);
        process.exit(1);
    }
    console.log(`quizzen: ${quizzen.length} edities selecteren wat ze beloven`);
}

main().catch(async (err) => {
    console.error('quizzen: test mislukt', err);
    await pool.end().catch(() => {});
    process.exit(1);
});
