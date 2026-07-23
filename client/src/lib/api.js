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
export async function maakLobby(naam = 'Host') {
    const resp = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam }),
    });
    const data = await jsonOfNull(resp);
    if (!resp.ok) throw new Error(data?.fout || 'Kon geen lobby aanmaken.');
    return data;
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
