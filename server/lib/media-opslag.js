// =====================================================================
// Waar staan de MP3's? (lokaal of op de NAS)
//
// In de containers is /media altijd de mediamap; op de host bepaalt
// MEDIA_PAD (.env) of dat ./media is of een NAS-map. De paden in de
// database (/media/downloads/…) veranderen dus nooit.
//
// Vangnet:
//  - Een markeerbestand (.ventune-media) bewijst dat de map echt
//    gekoppeld is. Is de NAS weg (lege mountmap), dan slaan we downloads en
//    de dagelijkse bestandscontrole over, zodat de database nooit ten
//    onrechte "bestand ontbreekt" gaat zeggen.
//  - MEDIA_FALLBACK_DIR (/media-lokaal) is de oude lokale map. Ontbreekt
//    een bestand op de NAS, dan wordt daar gekeken (nginx doet hetzelfde
//    bij het afspelen).
// =====================================================================

const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');

const MARKER = '.ventune-media';
const CACHE_MS = 30 * 1000;

function mediaDir() { return path.resolve(process.env.MEDIA_DIR || '/media'); }
function fallbackDir() {
    const f = process.env.MEDIA_FALLBACK_DIR;
    if (!f) return null;
    const pad = path.resolve(f);
    return pad === mediaDir() ? null : pad;
}

let cache = { tijd: 0, waarde: null, dir: null };

async function heeftInhoud(dir) {
    for (const sub of ['downloads', 'uploads', 'collecties']) {
        try {
            const items = await fs.readdir(path.join(dir, sub));
            if (items.some((x) => !x.startsWith('.'))) return true;
        } catch { /* map bestaat niet */ }
    }
    return false;
}

/**
 * Is de mediamap echt beschikbaar? Bestaat het markeerbestand niet maar staan
 * er wel audiobestanden, dan is het een echte mediamap: markeer hem.
 * Een volledig lege map (nieuwe installatie) telt als beschikbaar, behalve
 * als MEDIA_OP_NAS=true: dan is leeg = NAS niet gekoppeld.
 */
async function beschikbaar(dir = mediaDir()) {
    if (cache.dir === dir && Date.now() - cache.tijd < CACHE_MS) return cache.waarde;
    let ok = false;
    try {
        await fs.access(path.join(dir, MARKER));
        ok = true;
    } catch {
        if (await heeftInhoud(dir)) {
            ok = true;
            await fs.writeFile(path.join(dir, MARKER), `VenTune mediamap\n${new Date().toISOString()}\n`).catch(() => {});
        } else if (process.env.MEDIA_OP_NAS !== 'true') {
            ok = true;
            await fs.mkdir(dir, { recursive: true }).catch(() => {});
            await fs.writeFile(path.join(dir, MARKER), `VenTune mediamap\n${new Date().toISOString()}\n`).catch(() => {});
        }
    }
    if (!ok && cache.waarde !== false) logger.waarschuwing('Mediamap niet bereikbaar (NAS niet gekoppeld?)', { dir });
    cache = { tijd: Date.now(), waarde: ok, dir };
    return ok;
}

/** Zoek een bestand: eerst in de mediamap, anders in de lokale reservemap. */
async function vindBestand(absoluut) {
    if (!absoluut) return null;
    try { await fs.access(absoluut); return absoluut; } catch { /* verder */ }
    const reserve = fallbackDir();
    if (!reserve) return null;
    const relatief = path.relative(mediaDir(), absoluut);
    if (!relatief || relatief.startsWith('..') || path.isAbsolute(relatief)) return null;
    const kandidaat = path.join(reserve, relatief);
    try { await fs.access(kandidaat); return kandidaat; } catch { return null; }
}

async function vrijeRuimte(dir) {
    try {
        const s = await fs.statfs(dir);
        return { vrijGb: Math.round((s.bavail * s.bsize) / 1e8) / 10, totaalGb: Math.round((s.blocks * s.bsize) / 1e8) / 10 };
    } catch { return null; }
}

async function status() {
    const dir = mediaDir();
    const reserve = fallbackDir();
    return {
        opNas: process.env.MEDIA_OP_NAS === 'true',
        hostPad: process.env.MEDIA_PAD || './media',
        beschikbaar: await beschikbaar(dir),
        ruimte: await vrijeRuimte(dir),
        reserve: reserve ? { beschikbaar: await heeftInhoud(reserve), ruimte: await vrijeRuimte(reserve) } : null,
    };
}

function vergeet() { cache = { tijd: 0, waarde: null, dir: null }; }

module.exports = { beschikbaar, vindBestand, status, vergeet, MARKER };
