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

/**
 * Geef de af te spelen bron voor een clip. iTunes-URL's lopen via de
 * audio-proxy (same-origin, https) zodat iOS ze afspeelt; lokale/relatieve
 * paden blijven ongewijzigd.
 */
export function audioBron(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) && /(mzstatic\.com|itunes\.apple\.com|apple\.com)/i.test(url)) {
        return '/api/audio?src=' + encodeURIComponent(url);
    }
    return url;
}

// --- Hostaccount ---

export async function authSessie() {
    const resp = await fetch('/api/auth/session', { credentials: 'include' });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Account kon niet worden gecontroleerd.');
    return data || { ingelogd: false, gebruiker: null };
}

export async function authInloggen(gegevens) {
    const resp = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gegevens),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Inloggen mislukt.');
    return data;
}

export async function authRegistreren(gegevens) {
    const resp = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gegevens),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Account maken mislukt.');
    return data;
}

export async function authUitloggen() {
    const resp = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Uitloggen mislukt.');
    return data;
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
        credentials: 'include',
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
        bekendheid: String(filters.min_bekendheid ?? 0),
        zonder: (filters.zonder_genres || []).join(','),
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

/** Ranglijst over alle gespeelde spellen. */
export async function haalRanking() {
    const resp = await fetch('/api/ranking');
    return (await jsonOfNull(resp)) || [];
}

/** Publieke wijzigingen die spelers mogen zien. */
export async function haalChangelog() {
    const resp = await fetch('/api/changelog');
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Changelog kon niet worden geladen.');
    return data?.entries || [];
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
export async function adminZoekYoutube(titelId) {
    return adminFetch(`/api/admin/titels/${titelId}/youtube-zoek`, {
        method: 'POST',
    });
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
export async function adminDownloadTrack(id) {
    return adminFetch(`/api/admin/tracks/${id}/download`, { method: 'POST' });
}
export async function adminUploadTrack(titelId, bestand, gegevens = {}) {
    const form = new FormData();
    form.append('bestand', bestand);
    if (gegevens.tracknaam) form.append('tracknaam', gegevens.tracknaam);
    if (gegevens.artiest) form.append('artiest', gegevens.artiest);
    return adminFetch(`/api/admin/titels/${titelId}/tracks/upload`, {
        method: 'POST',
        body: form,
    });
}
export async function adminSeed(force = false) {
    return adminFetch('/api/admin/seed', { method: 'POST', ...jsonBody({ force }) });
}
export async function adminSeedStatus() {
    return adminFetch('/api/admin/seed/status');
}
export async function adminPlaylistImport(titel = '') {
    return adminFetch('/api/admin/playlists/import', {
        method: 'POST',
        ...jsonBody({ titel }),
    });
}
export async function adminPlaylistStatus() {
    return adminFetch('/api/admin/playlists/status');
}
export async function adminTmdbImport() {
    return adminFetch('/api/admin/tmdb/import', { method: 'POST' });
}
export async function adminTmdbStatus() {
    return adminFetch('/api/admin/tmdb/status');
}
export async function adminVragenImport(tmdb = false) {
    return adminFetch('/api/admin/vragen/import', {
        method: 'POST',
        ...jsonBody({ tmdb }),
    });
}
export async function adminVragenStatus() {
    return adminFetch('/api/admin/vragen/status');
}
export async function adminOverzicht() {
    return adminFetch('/api/admin/overzicht');
}
export async function adminOntbrekendeTracks() {
    return adminFetch('/api/admin/ontbrekende-tracks');
}
export async function adminGebruikers() {
    return adminFetch('/api/admin/gebruikers');
}
export async function adminMaakGebruiker(data) {
    return adminFetch('/api/admin/gebruikers', { method: 'POST', ...jsonBody(data) });
}
export async function adminBewerkGebruiker(id, data) {
    return adminFetch(`/api/admin/gebruikers/${id}`, { method: 'PATCH', ...jsonBody(data) });
}
export async function adminGebruikerStatus(id, actief) {
    return adminFetch(`/api/admin/gebruikers/${id}`, {
        method: 'PATCH',
        ...jsonBody({ actief }),
    });
}
export async function adminResetWachtwoord(id, wachtwoord) {
    return adminFetch(`/api/admin/gebruikers/${id}/wachtwoord`, {
        method: 'POST',
        ...jsonBody({ wachtwoord }),
    });
}
export async function adminTrackStatus(id, data) {
    return adminFetch(`/api/admin/tracks/${id}`, { method: 'PATCH', ...jsonBody(data) });
}
export async function adminVragen(titelId) {
    return adminFetch(`/api/admin/titels/${titelId}/vragen`);
}
export async function adminVerwijderVraag(id) {
    return adminFetch(`/api/admin/vragen/${id}`, { method: 'DELETE' });
}
export async function adminMeldingen() {
    return adminFetch('/api/admin/meldingen');
}
export async function adminMeldingAf(id) {
    return adminFetch(`/api/admin/meldingen/${id}/afgehandeld`, { method: 'POST' });
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
