// =====================================================================
// IGDB (videogames) via de Twitch-API. Nodig in .env:
//   IGDB_CLIENT_ID=...       (Twitch Developer Console → Applications)
//   IGDB_CLIENT_SECRET=...
// Zonder sleutels valt het aanvraagscherm terug op Wikipedia.
// =====================================================================

let token = null;
let verloopt = 0;

function beschikbaar() {
    return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

async function haalToken() {
    if (token && Date.now() < verloopt) return token;
    const params = new URLSearchParams({
        client_id: process.env.IGDB_CLIENT_ID,
        client_secret: process.env.IGDB_CLIENT_SECRET,
        grant_type: 'client_credentials',
    });
    const r = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Twitch-token mislukt (${r.status})`);
    const d = await r.json();
    token = d.access_token;
    verloopt = Date.now() + Math.max(60, (Number(d.expires_in) || 3600) - 300) * 1000;
    return token;
}

// IGDB-genres naar de VenTune-genres.
const GENRE = {
    Shooter: 'Shooter', Platform: 'Platform', Puzzle: 'Puzzel', Racing: 'Race', Sport: 'Sport',
    Fighting: 'Vechtspel', 'Role-playing (RPG)': 'RPG', Strategy: 'Strategie', 'Real Time Strategy (RTS)': 'Strategie',
    'Turn-based strategy (TBS)': 'Strategie', Tactical: 'Strategie', Simulator: 'Simulatie', Adventure: 'Avontuur',
    "Hack and slash/Beat 'em up": 'Actie', Arcade: 'Actie', 'Point-and-click': 'Avontuur', Music: 'Muziek',
    Quiz: 'Party', 'Card & Board Game': 'Puzzel', MOBA: 'Strategie', Pinball: 'Actie', Indie: 'Indie',
};

function zetGenres(g) {
    const uit = new Set();
    for (const x of g?.genres || []) if (GENRE[x.name]) uit.add(GENRE[x.name]);
    for (const x of g?.themes || []) {
        if (x.name === 'Horror' || x.name === 'Survival') uit.add('Horror');
        if (x.name === 'Action') uit.add('Actie');
        if (x.name === 'Open world') uit.add('Open wereld');
        if (x.name === 'Party') uit.add('Party');
    }
    return [...uit].slice(0, 4);
}

async function zoek(q, { limiet = 12 } = {}) {
    const t = await haalToken();
    const term = String(q).replace(/"/g, '').slice(0, 100);
    const body = `search "${term}"; fields name,first_release_date,cover.image_id,genres.name,themes.name,platforms.abbreviation,summary,total_rating_count; where version_parent = null; limit ${Math.min(20, limiet)};`;
    const r = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: `Bearer ${t}`, Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401) { token = null; }
    if (!r.ok) throw new Error(`IGDB gaf ${r.status}`);
    const lijst = await r.json();
    return lijst
        .sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0))
        .map((g) => ({
            extern_id: String(g.id),
            naam: g.name,
            jaar: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
            poster: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null,
            omschrijving: [(g.platforms || []).map((p) => p.abbreviation).filter(Boolean).slice(0, 5).join(', '), String(g.summary || '').slice(0, 120)].filter(Boolean).join(' — '),
            genres: zetGenres(g),
            bron: 'igdb',
        }));
}

module.exports = { beschikbaar, zoek, zetGenres };
