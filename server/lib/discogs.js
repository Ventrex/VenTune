// =====================================================================
// Discogs (muziek en artiesten). Nodig in .env:
//   DISCOGS_TOKEN=...   (discogs.com → Settings → Developers → token)
// Zonder token zoekt het aanvraagscherm alleen via iTunes.
// =====================================================================

function beschikbaar() {
    return Boolean(process.env.DISCOGS_TOKEN);
}

// Discogs-genres/-stijlen naar de VenTune-genres.
const GENRE = {
    Rock: 'Rock', Pop: 'Pop', 'Hip Hop': 'Hiphop', Electronic: 'Dance', Jazz: 'Jazz', Classical: 'Klassiek',
    Reggae: 'Reggae', Latin: 'Latin', 'Funk / Soul': 'Soul', Blues: 'Blues', 'Folk, World, & Country': 'Country',
    "Children's": 'Kinderlied', 'Stage & Screen': 'Soundtrack', Schlager: 'Schlager',
    Disco: 'Disco', 'Hard Rock': 'Rock', 'Heavy Metal': 'Metal', Punk: 'Punk', 'Rhythm & Blues': 'R&B', RnB: 'R&B',
    Synthpop: 'Pop', House: 'Dance', Techno: 'Dance', Trance: 'Dance', Eurodance: 'Dance', Levenslied: 'Levenslied',
    Ballad: 'Pop', Indie: 'Indie', 'Indie Rock': 'Indie', Alternative: 'Alternatief', 'Alternative Rock': 'Alternatief',
    Funk: 'Funk', Soul: 'Soul', Country: 'Country', Christmas: 'Kerst', Holiday: 'Kerst',
};

function zetGenres(r) {
    const uit = new Set();
    for (const x of [...(r.genre || []), ...(r.style || [])]) if (GENRE[x]) uit.add(GENRE[x]);
    return [...uit].slice(0, 4);
}

// Versie-aanduidingen weghalen: "Bad Mojo Maker (Extended Version)" → "Bad Mojo Maker".
const VERSIE = /\s*[([](?:[^)\]]*\b(?:version|versie|mix|remix|edit|remaster(?:ed)?|radio|extended|single|live|instrumental|acoustic|mono|stereo|demo|club|dub|original)\b[^)\]]*)[)\]]/gi;
function schoonTitel(t) {
    return String(t || '').replace(VERSIE, '').replace(/\s+-\s+(?:remaster(?:ed)?|radio edit|single version).*$/i, '').replace(/\s+/g, ' ').trim();
}

async function zoek(q, { limiet = 10 } = {}) {
    // Alleen singles: zo kan niemand een heel album aanvragen.
    const params = new URLSearchParams({ q: String(q).slice(0, 100), type: 'release', format: 'single', per_page: '30' });
    const r = await fetch(`https://api.discogs.com/database/search?${params}`, {
        headers: { Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`, 'User-Agent': 'VenTune/1.0 (self-hosted quiz)' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Discogs gaf ${r.status}`);
    const d = await r.json();
    const gezien = new Set();
    return (d.results || []).filter((x) => {
        const formats = (x.format || []).map((f) => String(f).toLowerCase());
        return !formats.some((f) => ['album', 'lp', 'compilation', 'ep'].includes(f));
    }).map((x) => {
        // Discogs-titel: "Artiest - Titel"
        const [artiest, ...rest] = String(x.title || '').split(' - ');
        return {
            extern_id: String(x.master_id || x.id),
            naam: schoonTitel(rest.join(' - ') || artiest),
            artiest: rest.length ? artiest.replace(/\s*\(\d+\)$/, '').trim() : '',
            jaar: Number(x.year) || null,
            poster: x.cover_image && !/spacer\.gif/.test(x.cover_image) ? x.cover_image : null,
            genres: zetGenres(x),
            bron: 'discogs',
        };
    }).filter((r) => {
        // Elke persing van dezelfde single maar één keer tonen.
        const k = `${r.naam.toLowerCase()}|${r.artiest.toLowerCase()}`;
        if (!r.naam || gezien.has(k)) return false;
        gezien.add(k);
        return true;
    }).slice(0, limiet);
}

module.exports = { beschikbaar, zoek, zetGenres, schoonTitel };
