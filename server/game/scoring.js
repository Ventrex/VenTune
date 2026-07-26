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

/**
 * Leeftijdsbonus voor een host die kinderen extra wil laten meetellen.
 * De eerste passende grens geldt: tot en met 6, tot en met 9, enzovoort.
 */
function leeftijdsFactor(leeftijd, instellingen = {}) {
    if (instellingen.leeftijdspunten_aan !== true) return 1;
    const leeftijdGetal = Number(leeftijd);
    if (!Number.isFinite(leeftijdGetal)) return 1;
    const standaard = { 6: 2, 9: 1.75, 12: 1.5, 16: 1.25, 18: 1 };
    const factoren = { ...standaard, ...(instellingen.leeftijdsfactoren || {}) };
    for (const grens of [6, 9, 12, 16, 18]) {
        if (leeftijdGetal <= grens) {
            const factor = Number(factoren[grens]);
            return Number.isFinite(factor) && factor > 0 ? factor : 1;
        }
    }
    return 1;
}

module.exports = { titelPunten, bonusPunten, leeftijdsFactor };
