// =====================================================================
// Kleine API-helper voor de client. Alle verzoeken gaan same-origin via
// nginx naar de server.
// =====================================================================

async function jsonOfNull(resp) {
    try {
        return await resp.json();
    } catch {
        return null;
    }
}

/** Zoek muziek op iTunes via de server. Geeft { term, aantal, resultaten }. */
export async function zoekMuziek(term, land) {
    const params = new URLSearchParams({ term });
    if (land) params.set('land', land);
    const resp = await fetch(`/api/muziek/zoek?${params.toString()}`);
    const data = await jsonOfNull(resp);
    if (!resp.ok) {
        throw new Error(data?.fout || 'Zoeken mislukt.');
    }
    return data;
}

// --- Lobby ---

/** Host maakt een nieuw spel aan. Geeft { code, token, spelerId, is_host }. */
export async function maakLobby(instellingen = {}, naam = 'Host') {
    const resp = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam, instellingen }),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Kon geen lobby aanmaken.');
    return data;
}

// --- Setup: telling en presets ---

/** Live telling van beschikbare titels/tracks voor de gekozen filters. */
export async function haalTelling(filters) {
    const params = new URLSearchParams({
        categorie: filters.categorie,
        taal: filters.taal,
        start: String(filters.periode_start),
        eind: String(filters.periode_eind),
    });
    const resp = await fetch(`/api/tracks/telling?${params.toString()}`);
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Kon de telling niet ophalen.');
    return data;
}

/** Alle opgeslagen presets ophalen. */
export async function haalPresets() {
    const resp = await fetch('/api/presets');
    return (await jsonOfNull(resp)) || [];
}

/** Een preset opslaan. */
export async function bewaarPreset(preset) {
    const resp = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Kon de preset niet opslaan.');
    return data;
}

/** Een preset verwijderen. */
export async function verwijderPreset(id) {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' });
}

// --- Admin ---

async function adminFetch(pad, opties = {}) {
    const resp = await fetch(pad, { credentials: 'include', ...opties });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Er ging iets mis.');
    return data;
}

function jsonBody(obj) {
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export async function adminSessie() {
    const resp = await fetch('/api/admin/sessie', { credentials: 'include' });
    return (await jsonOfNull(resp)) || { ingelogd: false };
}
export async function adminLogin(wachtwoord) {
    return adminFetch('/api/admin/login', { method: 'POST', ...jsonBody({ wachtwoord }) });
}
export async function adminLogout() {
    return adminFetch('/api/admin/logout', { method: 'POST' });
}
export async function adminTitels(zoek = '') {
    return adminFetch(`/api/admin/titels?zoek=${encodeURIComponent(zoek)}`);
}
export async function adminMaakTitel(data) {
    return adminFetch('/api/admin/titels', { method: 'POST', ...jsonBody(data) });
}
export async function adminUpdateTitel(id, data) {
    return adminFetch(`/api/admin/titels/${id}`, { method: 'PUT', ...jsonBody(data) });
}
export async function adminVerwijderTitel(id) {
    return adminFetch(`/api/admin/titels/${id}`, { method: 'DELETE' });
}
export async function adminTracks(titelId) {
    return adminFetch(`/api/admin/titels/${titelId}/tracks`);
}
export async function adminVoegTrack(titelId, data) {
    return adminFetch(`/api/admin/titels/${titelId}/tracks`, {
        method: 'POST',
        ...jsonBody(data),
    });
}
export async function adminVerwijderTrack(id) {
    return adminFetch(`/api/admin/tracks/${id}`, { method: 'DELETE' });
}
export async function adminSeed(force = false) {
    return adminFetch('/api/admin/seed', { method: 'POST', ...jsonBody({ force }) });
}

/** Controleer of een lobbycode bestaat en of je kunt joinen. */
export async function checkLobby(code) {
    const resp = await fetch(`/api/lobby/${encodeURIComponent(code)}`);
    if (resp.status === 404) return { bestaat: false };
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Kon lobby niet controleren.');
    return data;
}

/** Speler doet mee. Geeft { token, spelerId, code, is_host }. */
export async function joinLobby(code, naam) {
    const resp = await fetch(`/api/lobby/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam }),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Meedoen mislukt.');
    return data;
}
