// Voorzichtige herstructurering van bestaande lokale audio.
//
// Eerst wordt altijd een plan gemaakt. Alleen een expliciete uitvoeractie
// verplaatst bestanden en werkt bestand_pad/preview_url bij. Er wordt niets
// verwijderd en ontbrekende bronbestanden worden alleen gemeld.

const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../db/pool');
const { absoluutPad } = require('./media-files');
const { mediaWebpad } = require('./media-naming');

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || '/media');
const MAX_ITEMS = 50_000;

async function bestaat(pad) {
    try {
        await fs.stat(pad);
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
    }
}

async function vrijeDoelPad(titel, mediaMap, extensie, gewenstPad, bronPad, gereserveerd) {
    if (
        (!(await bestaat(gewenstPad)) || path.resolve(gewenstPad) === path.resolve(bronPad))
        && !gereserveerd.has(path.resolve(gewenstPad))
    ) {
        return gewenstPad;
    }

    for (let nummer = 2; nummer <= 999; nummer++) {
        const kandidaat = mediaWebpad(
            MEDIA_DIR,
            titel,
            mediaMap,
            extensie,
            ` - ${nummer}`,
        ).bestand;
        if (
            (!(await bestaat(kandidaat)) || path.resolve(kandidaat) === path.resolve(bronPad))
            && !gereserveerd.has(path.resolve(kandidaat))
        ) {
            return kandidaat;
        }
    }
    throw new Error(`Geen vrije bestandsnaam gevonden voor ${titel.naam}.`);
}

async function laadTracks(slug = '') {
    const params = [];
    let collectieVoorwaarde = '';
    if (slug) {
        params.push(slug);
        collectieVoorwaarde = 'AND c.slug = $1';
    }
    const { rows } = await pool.query(
        `SELECT tr.id, tr.bestand_pad, tr.preview_url, tr.bron,
                t.naam, t.type, t.jaar, t.genres, t.taal, t.land, t.talen,
                c.slug AS collectie_slug, c.media_map
           FROM tracks tr
           JOIN titels t ON t.id = tr.titel_id
           LEFT JOIN media_collecties c ON c.id = tr.collectie_id
          WHERE tr.bestand_pad IS NOT NULL
            AND tr.bestand_pad <> ''
            ${collectieVoorwaarde}
          ORDER BY tr.id
          LIMIT ${MAX_ITEMS}`,
        params,
    );
    return rows;
}

async function maakOpschoonPlan({ slug = '' } = {}) {
    const tracks = await laadTracks(slug);
    const plan = [];
    const gereserveerd = new Set();
    for (const track of tracks) {
        const bron = absoluutPad(track.bestand_pad);
        const extensie = path.extname(track.bestand_pad || '') || '.m4a';
        if (!bron) {
            plan.push({
                id: track.id,
                titel: track.naam,
                oud: track.bestand_pad,
                status: 'onveilig-pad',
            });
            continue;
        }

        const gewenst = mediaWebpad(
            MEDIA_DIR,
            track,
            track.media_map,
            extensie,
        );
        const bronBestaat = await bestaat(bron);
        if (!bronBestaat) {
            plan.push({
                id: track.id,
                titel: track.naam,
                oud: track.bestand_pad,
                nieuw: gewenst.lokaal,
                status: 'bron-ontbreekt',
            });
            continue;
        }

        const doel = await vrijeDoelPad(
            track,
            track.media_map,
            extensie,
            gewenst.bestand,
            bron,
            gereserveerd,
        );
        gereserveerd.add(path.resolve(doel));
        const doelUrl = `/media/${path.relative(MEDIA_DIR, doel).split(path.sep).join('/')}`;
        plan.push({
            id: track.id,
            titel: track.naam,
            type: track.type,
            collectie: track.collectie_slug || 'legacy',
            oud: track.bestand_pad,
            nieuw: doelUrl,
            naam: path.basename(doel),
            status: path.resolve(bron) === path.resolve(doel) ? 'al-goed' : 'verplaatsen',
        });
    }
    return plan;
}

function telPlan(plan) {
    return plan.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});
}

async function voerOpschoningUit({ slug = '', droog = true } = {}) {
    const plan = await maakOpschoonPlan({ slug });
    if (droog) {
        return {
            droog: true,
            totaal: plan.length,
            aantallen: telPlan(plan),
            items: plan.slice(0, 200),
        };
    }

    let verplaatst = 0;
    const fouten = [];
    for (const item of plan.filter((regel) => regel.status === 'verplaatsen')) {
        const bron = absoluutPad(item.oud);
        const doel = absoluutPad(item.nieuw);
        if (!bron || !doel) {
            fouten.push({ id: item.id, fout: 'Onveilig bron- of doelpad.' });
            continue;
        }
        try {
            if (await bestaat(doel) && path.resolve(doel) !== path.resolve(bron)) {
                throw new Error('Doelbestand bestaat inmiddels al; preview opnieuw uitvoeren.');
            }
            await fs.mkdir(path.dirname(doel), { recursive: true });
            await fs.rename(bron, doel);
            await pool.query(
                `UPDATE tracks
                    SET bestand_pad = $2, preview_url = $2,
                        bron = 'lokaal', download_status = 'available',
                        download_melding = NULL
                  WHERE id = $1`,
                [item.id, item.nieuw],
            );
            verplaatst++;
        } catch (err) {
            fouten.push({ id: item.id, titel: item.titel, fout: err.message });
        }
    }

    return {
        droog: false,
        totaal: plan.length,
        verplaatst,
        fouten,
        aantallen: telPlan(plan),
        items: plan.slice(0, 200),
    };
}

module.exports = {
    maakOpschoonPlan,
    voerOpschoningUit,
    telPlan,
};
