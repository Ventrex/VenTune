// =====================================================================
// Test voor de zoekwachtrij.
//
// Het probleem dat dit voorkomt: als de import telkens dezelfde eerste
// 250 titels pakt en die leveren niets op, dan komt de vragenbank nooit
// verder. Een run moet dus altijd dóórschuiven naar de volgende titels.
//
// Draait alleen met TEST_DATABASE_URL; anders wordt de test overgeslagen.
// =====================================================================

const url = process.env.TEST_DATABASE_URL;
if (!url) {
    console.log('wachtrij: overgeslagen (TEST_DATABASE_URL ontbreekt)');
    process.exit(0);
}
process.env.DATABASE_URL = url;

const { pool } = require('../db/pool');

let mislukt = 0;
function check(naam, waar, extra) {
    if (!waar) {
        mislukt++;
        console.error(`FOUT: ${naam}${extra ? ` → ${extra}` : ''}`);
    }
}

// Dezelfde selectie als seed/import.js gebruikt voor --db.
const WACHTRIJ = `
    SELECT id, naam, zoek_pogingen, zoek_status
      FROM titels t
     WHERE NOT EXISTS (SELECT 1 FROM tracks x WHERE x.titel_id = t.id
                        AND x.werkt = true AND x.preview_url IS NOT NULL
                        AND x.preview_url <> ''
                        AND (x.bron = 'youtube' OR
                             (x.bron = 'lokaal' AND x.itunes_track_id IS NULL
                              AND x.download_status = 'available')))
       AND t.zoek_status <> 'opgegeven'
       AND (t.volgende_poging IS NULL OR t.volgende_poging <= now())
     ORDER BY t.zoek_pogingen ASC,
              t.laatste_zoekpoging ASC NULLS FIRST,
              t.populariteit DESC,
              t.id
     LIMIT $1`;

// Dezelfde administratie als noteerZoekpoging in seed/import.js.
const WACHTTIJD_UREN = [6, 24, 72, 168];
async function noteerMislukt(id) {
    await pool.query(
        `UPDATE titels
            SET zoek_pogingen = zoek_pogingen + 1,
                laatste_zoekpoging = now(),
                zoek_status = CASE WHEN zoek_pogingen + 1 >= $2 THEN 'opgegeven'
                                   ELSE 'geen_kandidaat' END,
                volgende_poging = CASE WHEN zoek_pogingen + 1 >= $2 THEN NULL
                                       ELSE now() + ($3::int[])[LEAST(zoek_pogingen + 1, $2 - 1)] * interval '1 hour'
                                  END
          WHERE id = $1`,
        [id, WACHTTIJD_UREN.length + 1, WACHTTIJD_UREN],
    );
}

async function main() {
    await pool.query(`DELETE FROM titels WHERE naam LIKE 'WachtrijTest%'`);
    for (let i = 1; i <= 10; i++) {
        await pool.query(
            `INSERT INTO titels (naam, aliassen, type, taal, jaar, genres)
             VALUES ($1, '{}', 'film', 'nl', 2000, '{}')`,
            [`WachtrijTest ${String(i).padStart(2, '0')}`],
        );
    }

    async function batch(n) {
        const { rows } = await pool.query(WACHTRIJ, [n]);
        return rows.filter((r) => r.naam.startsWith('WachtrijTest'));
    }

    // Batch 1 en 2 moeten verschillende titels opleveren.
    const eerste = await batch(30);
    const eersteVier = eerste.slice(0, 4);
    check('eerste batch levert titels op', eersteVier.length === 4, String(eersteVier.length));
    for (const t of eersteVier) await noteerMislukt(t.id);

    const tweede = await batch(30);
    const overlap = tweede.filter((t) => eersteVier.some((e) => e.id === t.id));
    check(
        'de tweede batch pakt niet dezelfde titels',
        overlap.length === 0,
        `${overlap.length} dezelfde`,
    );
    check(
        'de tweede batch heeft de overige titels',
        tweede.length === 6,
        String(tweede.length),
    );

    // Na de wachttijd komt een mislukte titel gewoon weer terug.
    await pool.query(
        `UPDATE titels SET volgende_poging = now() - interval '1 hour'
          WHERE id = $1`,
        [eersteVier[0].id],
    );
    const derde = await batch(30);
    check(
        'na de wachttijd staat de titel weer in de rij',
        derde.some((t) => t.id === eersteVier[0].id),
    );
    check(
        'maar wel achteraan',
        derde[derde.length - 1].id === eersteVier[0].id,
        derde.map((t) => t.naam).join(', '),
    );

    // Te vaak mislukt = opgegeven; blokkeert de rij niet meer.
    const kop = eersteVier[1];
    for (let i = 0; i < 6; i++) {
        await pool.query(`UPDATE titels SET volgende_poging = NULL WHERE id = $1`, [kop.id]);
        await noteerMislukt(kop.id);
    }
    const { rows: status } = await pool.query(
        `SELECT zoek_status, zoek_pogingen FROM titels WHERE id = $1`,
        [kop.id],
    );
    check(
        'na genoeg pogingen wordt de titel opgegeven',
        status[0].zoek_status === 'opgegeven',
        JSON.stringify(status[0]),
    );
    const vierde = await batch(30);
    check(
        'een opgegeven titel blokkeert de wachtrij niet meer',
        !vierde.some((t) => t.id === kop.id),
    );

    // Een gevonden titel verdwijnt uit de rij.
    const doel = vierde[0];
    await pool.query(
        `INSERT INTO tracks (titel_id, bron, preview_url, tracknaam, artiest,
                             download_status, itunes_track_id)
         VALUES ($1, 'lokaal', '/media/x.mp3', 'Test', 'Test', 'available', NULL)`,
        [doel.id],
    );
    const vijfde = await batch(30);
    check(
        'een titel met lokale audio staat niet meer in de rij',
        !vijfde.some((t) => t.id === doel.id),
    );

    await pool.query(`DELETE FROM titels WHERE naam LIKE 'WachtrijTest%'`);
    await pool.end();

    if (mislukt > 0) {
        console.error(`wachtrij: ${mislukt} test(s) mislukt`);
        process.exit(1);
    }
    console.log('wachtrij: elke run schuift door naar de volgende titels');
}

main().catch(async (err) => {
    console.error('wachtrij: test mislukt', err);
    await pool.end().catch(() => {});
    process.exit(1);
});
