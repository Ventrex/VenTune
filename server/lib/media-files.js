// Veilige verwijdering van lokale audio.
//
// De database bewaart webpaden zoals /media/collecties/...; dit bestand
// vertaalt alleen zulke paden naar MEDIA_DIR en weigert alles buiten die
// map. Zo kan een foutieve databasewaarde nooit een willekeurig bestand op
// de server verwijderen.

const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../db/pool');

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || '/media');

function absoluutPad(bestandPad) {
    const waarde = String(bestandPad || '').trim();
    if (!waarde) return null;
    const relatief = waarde.startsWith('/media/')
        ? waarde.slice('/media/'.length)
        : waarde === '/media'
          ? ''
          : null;
    if (relatief === null) return null;
    const kandidaat = path.resolve(MEDIA_DIR, relatief);
    const vanafMedia = path.relative(MEDIA_DIR, kandidaat);
    if (!vanafMedia || vanafMedia.startsWith('..') || path.isAbsolute(vanafMedia)) {
        return null;
    }
    return kandidaat;
}

async function verwijderLokaalBestand(bestandPad) {
    const absoluut = absoluutPad(bestandPad);
    if (!absoluut) return { verwijderd: false, overgeslagen: true };

    const ouder = path.dirname(absoluut);
    const naam = path.basename(absoluut);
    const kandidaten = [naam];
    try {
        const bestanden = await fs.readdir(ouder);
        for (const item of bestanden) {
            if (item.startsWith(`${naam}.part-`)) kandidaten.push(item);
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    let verwijderd = false;
    for (const item of kandidaten) {
        try {
            await fs.unlink(path.join(ouder, item));
            verwijderd = true;
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    }
    return { verwijderd, overgeslagen: false };
}

async function verwijderBestanden(rijen) {
    let aantal = 0;
    for (const rij of rijen) {
        const resultaat = await verwijderLokaalBestand(rij.bestand_pad || rij.preview_url);
        if (resultaat.verwijderd) aantal++;
    }
    return aantal;
}

async function verwijderTitelMetBestanden(titelId, executor = pool) {
    const { rows: tracks } = await executor.query(
        `SELECT id, bestand_pad, preview_url FROM tracks WHERE titel_id = $1`,
        [titelId],
    );
    await verwijderBestanden(tracks);

    // Rondes verwijzen bewust naar titels zonder ON DELETE CASCADE; bij een
    // expliciete admin-verwijdering ruimen we de bijbehorende speelgeschiedenis
    // daarom eerst op, anders zou lokaal verwijderen onmogelijk blijven.
    await executor.query(
        `DELETE FROM rondes WHERE titel_id = $1`,
        [titelId],
    );
    const resultaat = await executor.query(
        `DELETE FROM titels WHERE id = $1 RETURNING id`,
        [titelId],
    );
    return { verwijderd: resultaat.rowCount > 0, bestanden: tracks.length };
}

async function verwijderCollectie(slug) {
    const client = await pool.connect();
    try {
        const { rows: collecties } = await client.query(
            `SELECT id, slug, naam FROM media_collecties WHERE slug = $1`,
            [slug],
        );
        if (!collecties[0]) return { verwijderd: false, reden: 'collectie-niet-gevonden' };
        const collectie = collecties[0];
        const { rows: tracks } = await client.query(
            `SELECT tr.id, tr.bestand_pad, tr.preview_url
               FROM tracks tr
              WHERE tr.collectie_id = $1`,
            [collectie.id],
        );

        // Eerst de lokale bestanden. Bij een fout blijft de database intact
        // en kan de admin veilig opnieuw proberen.
        const bestanden = await verwijderBestanden(tracks);

        await client.query('BEGIN');
        // Oude rondes kunnen naar nieuwe collectie-titels verwijzen. Alleen
        // die rondes worden verwijderd; alle andere spelgeschiedenis blijft.
        await client.query(
            `DELETE FROM rondes
              WHERE titel_id IN (SELECT id FROM titels WHERE collectie_id = $1)`,
            [collectie.id],
        );
        const resultaat = await client.query(
            `DELETE FROM media_collecties WHERE id = $1 RETURNING id, slug, naam`,
            [collectie.id],
        );
        await client.query('COMMIT');
        return {
            verwijderd: resultaat.rowCount > 0,
            collectie: resultaat.rows[0] || collectie,
            tracks: tracks.length,
            bestanden,
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    absoluutPad,
    verwijderLokaalBestand,
    verwijderBestanden,
    verwijderTitelMetBestanden,
    verwijderCollectie,
};

