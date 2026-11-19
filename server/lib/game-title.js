// Eén basisgame in de catalogus; Deluxe/Ultimate e.d. zijn geen aparte spellen.
const EDITIE = /(?:\s*[-:–—]\s*|\s+)\(?\s*(?:(?:digital|collector'?s|game\s+of\s+the\s+year)\s+)?(?:deluxe|ultimate|special|gold|premium|complete|definitive|standard|limited|collector'?s|goty)\s+edition\s*\)?$/i;
function normaliseerSpelUitgave(naam) {
    let v = String(naam || '').trim();
    for (let n = 0; n < 2; n++) v = v.replace(EDITIE, '').trim();
    return v;
}
function isBijzondereUitgave(naam) { return normaliseerSpelUitgave(naam) !== String(naam || '').trim(); }
module.exports = { normaliseerSpelUitgave, isBijzondereUitgave };
