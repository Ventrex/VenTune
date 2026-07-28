// =====================================================================
// Controleer alle bestaande koppelingen: hoort de muziek écht bij de
// titel? Verkeerde koppelingen (bijvoorbeeld muziek van Frozen onder de
// naam van een andere film) maken het spel onbruikbaar.
//
// Standaard alleen rapporteren. Met --ja worden verdachte tracks
// afgekeurd (werkt = false), zodat ze niet meer gespeeld worden. Ze
// blijven in de database staan, dus je kunt ze in /admin nog bekijken of
// weer goedkeuren.
//
// Gebruik (in de servercontainer):
//   node /app/seed/controleer-tracks.js            # rapport
//   node /app/seed/controleer-tracks.js --ja       # verdachte afkeuren
//   node /app/seed/controleer-tracks.js --ja --wis # verdachte verwijderen
// =====================================================================

const { pool } = require('../server/db/pool');
const { pastBijTitel } = require('../server/lib/trackcheck');

const args = process.argv.slice(2);
const DOEN = args.includes('--ja');
const WISSEN = args.includes('--wis');

async function main() {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.bron, tr.tracknaam, tr.artiest, tr.album,
                tr.werkt, tr.herkenbaarheid, tr.bevestigd, tr.songnaam,
                t.id AS titel_id, t.naam AS titel_naam, t.aliassen, t.jaar
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
          ORDER BY t.naam, tr.id`,
    );

    console.log(`${rows.length} tracks controleren…\n`);

    const verdacht = [];
    let goed = 0;

    for (const r of rows) {
        const uitkomst = pastBijTitel(
            { naam: r.titel_naam, aliassen: r.aliassen, jaar: r.jaar },
            {
                tracknaam: r.tracknaam,
                album: r.album,
                artiest: r.artiest,
                bevestigd: r.bevestigd,
            },
        );
        if (uitkomst.past) {
            goed++;
        } else {
            verdacht.push(r);
        }
    }

    console.log(`Past bij de titel:  ${goed}`);
    console.log(`Verdacht:           ${verdacht.length}`);

    if (verdacht.length > 0) {
        console.log('\n=== Verdachte koppelingen ===');
        for (const v of verdacht.slice(0, 60)) {
            console.log(
                `  "${v.titel_naam}"  ←  ${v.bron}: "${v.tracknaam}"` +
                    (v.album ? ` (album: ${v.album})` : '') +
                    (v.artiest ? ` — ${v.artiest}` : ''),
            );
        }
        if (verdacht.length > 60) {
            console.log(`  … en nog ${verdacht.length - 60} andere`);
        }
    }

    if (!DOEN) {
        console.log(
            '\nNiets gewijzigd. Voeg --ja toe om verdachte tracks af te keuren:\n' +
                '  node /app/seed/controleer-tracks.js --ja\n' +
                'Of --ja --wis om ze te verwijderen.',
        );
        await pool.end();
        return;
    }

    if (verdacht.length > 0) {
        const ids = verdacht.map((v) => v.id);
        if (WISSEN) {
            const uit = await pool.query(`DELETE FROM tracks WHERE id = ANY($1)`, [ids]);
            console.log(`\n${uit.rowCount} verdachte tracks verwijderd.`);
        } else {
            const uit = await pool.query(
                `UPDATE tracks SET werkt = false, gecontroleerd = false,
                        verificatie_score = 0,
                        verificatie_reden = 'afgekeurd door controle-script',
                        laatst_gecontroleerd_op = now()
                  WHERE id = ANY($1)`,
                [ids],
            );
            console.log(
                `\n${uit.rowCount} verdachte tracks afgekeurd (worden niet meer gespeeld).`,
            );
        }

        const goedeIds = rows
            .filter((r) => !verdacht.some((v) => v.id === r.id))
            .map((r) => r.id);
        if (goedeIds.length) {
            await pool.query(
                `UPDATE tracks SET gecontroleerd = true,
                        verificatie_score = GREATEST(verificatie_score, 0.95),
                        verificatie_reden = COALESCE(verificatie_reden, 'controle-script'),
                        laatst_gecontroleerd_op = now()
                  WHERE id = ANY($1)`,
                [goedeIds],
            );
        }
    }

    const d = await pool.query(
        `SELECT (SELECT count(*)::int FROM titels) AS titels,
                (SELECT count(*)::int FROM tracks) AS tracks,
                (SELECT count(*)::int FROM tracks WHERE werkt) AS bruikbaar,
                (SELECT count(*)::int FROM titels t
                  WHERE EXISTS (SELECT 1 FROM tracks x
                                 WHERE x.titel_id = t.id AND x.werkt)) AS speelbaar`,
    );
    const s = d.rows[0];
    console.log(
        `\nNu: ${s.titels} titels, ${s.tracks} tracks (${s.bruikbaar} bruikbaar), ` +
            `${s.speelbaar} speelbare titels.`,
    );
    console.log('\nOpnieuw goede muziek zoeken voor de rest:');
    console.log('  node /app/seed/playlist-import.js');
    console.log('  node /app/seed/import.js --db');

    await pool.end();
}

main().catch(async (err) => {
    console.error('Controle mislukt:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
});
