// =====================================================================
// Kleine API-helper voor de client. Alle verzoeken gaan same-origin via
// nginx naar de server, met cookies (voor de sessie).
// =====================================================================

async function jsonOfNull(resp) {
    try {
        return await resp.json();
    } catch {
        return null;
    }
}

/** Haal het huidige profiel op. Geeft null als je niet ingelogd bent. */
export async function haalMij() {
    const resp = await fetch('/api/me', { credentials: 'include' });
    if (resp.status === 401) return null;
    if (!resp.ok) throw new Error('Kon profiel niet ophalen.');
    return jsonOfNull(resp);
}

/** Start de Spotify-login door de browser naar de server te sturen. */
export function startLogin() {
    window.location.href = '/auth/login';
}

/** Log uit en wis de sessie. */
export async function logUit() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

/** Haal een geldig Spotify access token op (voor de Web Playback SDK). */
export async function haalSpotifyToken() {
    const resp = await fetch('/api/spotify/token', { credentials: 'include' });
    if (!resp.ok) throw new Error('Kon Spotify-token niet ophalen.');
    const data = await jsonOfNull(resp);
    return data?.access_token || null;
}
