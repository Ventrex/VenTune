// =====================================================================
// Puntentelling.
//
// - Titel goed: 100 punten, minus 2 per verstreken seconde (minimum 20).
// - Per gebruikte hint: −25.
// - Bonusvraag goed: +50, halveert bij de tweede poging (→ 25).
// =====================================================================

/**
 * Punten voor een goed geraden titel.
 * @param {number} verstrekenMs  Tijd sinds rondestart.
 * @param {number} hintsGebruikt Aantal hints deze ronde.
 */
function titelPunten(verstrekenMs, hintsGebruikt = 0) {
    const seconden = Math.floor(Math.max(0, verstrekenMs) / 1000);
    const basis = Math.max(20, 100 - 2 * seconden);
    const punten = basis - 25 * hintsGebruikt;
    return Math.max(0, punten);
}

/**
 * Punten voor een goede bonusvraag.
 * @param {number} poging  1 = eerste poging (50), 2 = tweede (25).
 */
function bonusPunten(poging) {
    if (poging <= 1) return 50;
    if (poging === 2) return 25;
    return 0;
}

module.exports = { titelPunten, bonusPunten };
