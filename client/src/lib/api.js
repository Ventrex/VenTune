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
