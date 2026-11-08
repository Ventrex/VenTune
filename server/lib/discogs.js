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

async function zoek(q, { limiet = 10 } = {}) {
    const params = new URLSearchParams({ q: String(q).slice(0, 100), type: 'master', per_page: String(Math.min(20, limiet)) });
    const r = await fetch(`https://api.discogs.com/database/search?${params}`, {
        headers: { Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`, 'User-Agent': 'VenTune/1.0 (self-hosted quiz)' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Discogs gaf ${r.status}`);
    const d = await r.json();
    return (d.results || []).map((x) => {
        // Discogs-titel: "Artiest - Titel"
        const [artiest, ...rest] = String(x.title || '').split(' - ');
        return {
            extern_id: String(x.master_id || x.id),
            naam: (rest.join(' - ') || artiest).trim(),
            artiest: rest.length ? artiest.replace(/\s*\(\d+\)$/, '').trim() : '',
            jaar: Number(x.year) || null,
            poster: x.cover_image && !/spacer\.gif/.test(x.cover_image) ? x.cover_image : null,
            genres: zetGenres(x),
            bron: 'discogs',
        };
    });
}

module.exports = { beschikbaar, zoek, zetGenres };
