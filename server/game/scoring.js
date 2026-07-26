// =====================================================================
// Puntentelling.
//
// - Titel goed: 100 punten, lineair naar 0 na 10 seconden.
// - Kindmodus: 200 punten, lineair naar 0 na 20 seconden.
// - Per gebruikte hint: −25.
// - Bonusvraag goed: basis +50, met een snelheidsbonus die afneemt naarmate
//   de speler langer wacht. Een tweede poging heeft een lagere basis.
// =====================================================================

/**
 * Punten voor een goed geraden titel.
 * @param {number} verstrekenMs  Tijd sinds rondestart.
 * @param {number} hintsGebruikt Aantal hints deze ronde.
 * @param {object} instellingen Spelinstellingen, inclusief kindvriendelijk.
 */
function titelPunten(verstrekenMs, hintsGebruikt = 0, instellingen = {}) {
    const kindvriendelijk = instellingen.kindvriendelijk === true;
    const maximum = kindvriendelijk ? 200 : 100;
    const vervaltNaMs = kindvriendelijk ? 20000 : 10000;
    const verstreken = Math.max(0, Number(verstrekenMs) || 0);
    const basis = Math.max(0, Math.round(maximum * (1 - (verstreken / vervaltNaMs))));
    const punten = basis - 25 * hintsGebruikt;
    return Math.max(0, punten);
}

/**
 * Punten voor een goede bonusvraag.
 * @param {number} poging  1 = eerste poging, 2 = tweede poging.
 * @param {number} verstrekenMs Tijd sinds het tonen van de bonusvraag.
 */
function bonusPunten(poging, verstrekenMs = 0) {
    const basis = poging <= 1 ? 50 : poging === 2 ? 25 : 0;
    if (!basis) return 0;
    // Geen eindtijd: ook na lang nadenken blijft er een kleine beloning,
    // maar snel antwoorden levert zichtbaar meer punten op.
    const seconden = Math.max(0, Number(verstrekenMs) || 0) / 1000;
    const factor = Math.max(0.5, 1.5 - (seconden / 60));
    return Math.round(basis * factor);
}

/**
 * Leeftijdsbonus voor een host die kinderen extra wil laten meetellen.
 * De eerste passende grens geldt: tot en met 6, tot en met 9, enzovoort.
 */
function leeftijdsFactor(leeftijd, instellingen = {}) {
    // Kindmodus heeft een eigen basis (200/20 seconden) en gebruikt geen
    // vermenigvuldiger. Zo wordt een kind niet kunstmatig boven volwassenen
    // gezet door én 200 basispunten én ×2 te krijgen.
    if (instellingen.kindvriendelijk === true) return 1;
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
