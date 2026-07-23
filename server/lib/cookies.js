// =====================================================================
// Minimale cookie-helpers — parsen en serialiseren zonder externe
// dependency. Voldoende voor het ene sessie-cookie dat VenTune zet.
// =====================================================================

/** Parseer de Cookie-header naar een object. */
function parse(cookieHeader) {
    const uit = {};
    if (!cookieHeader) return uit;
    for (const deel of cookieHeader.split(';')) {
        const index = deel.indexOf('=');
        if (index < 0) continue;
        const naam = deel.slice(0, index).trim();
        const waarde = deel.slice(index + 1).trim();
        if (naam) uit[naam] = decodeURIComponent(waarde);
    }
    return uit;
}

/** Bouw een Set-Cookie-waarde. */
function serialiseer(naam, waarde, opties = {}) {
    const delen = [`${naam}=${encodeURIComponent(waarde)}`];
    if (opties.maxAge != null) delen.push(`Max-Age=${Math.floor(opties.maxAge)}`);
    delen.push(`Path=${opties.path || '/'}`);
    if (opties.httpOnly) delen.push('HttpOnly');
    if (opties.secure) delen.push('Secure');
    delen.push(`SameSite=${opties.sameSite || 'Lax'}`);
    return delen.join('; ');
}

module.exports = { parse, serialiseer };
