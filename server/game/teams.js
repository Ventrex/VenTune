// =====================================================================
// Teams eerlijk verdelen.
//
// 1. Kinderen (t/m 12) en senioren (60+) gaan eerst om en om over de
//    teams, zodat elk team een vergelijkbare leeftijdsmix krijgt.
// 2. Daarna de rest op sterkte (gemiddelde score uit eerdere spellen,
//    onbekend = middelmaat): steeds naar het team met de minste spelers
//    en daarbinnen de laagste totale sterkte.
// Teamgroottes verschillen zo nooit meer dan één speler.
// =====================================================================

const TEAMNAMEN = ['Team Rood', 'Team Blauw', 'Team Groen', 'Team Geel', 'Team Paars', 'Team Oranje', 'Team Roze', 'Team Wit'];

function leeftijdsGroep(leeftijd) {
    const l = Number(leeftijd);
    if (!Number.isFinite(l) || l <= 0) return 'onbekend';
    if (l <= 12) return 'kind';
    if (l >= 60) return 'senior';
    return 'volwassen';
}

/**
 * @param {Array<{id:string, naam?:string, leeftijd?:number, sterkte?:number|null}>} spelers
 * @param {number} aantal  aantal teams (2–8)
 * @param {string[]} namen bestaande teamnamen (worden aangevuld)
 * @returns {{teams:string[], indeling:Object<string,string>}}
 */
function verdeelEerlijk(spelers, aantal, namen = []) {
    const n = Math.max(2, Math.min(8, Math.round(Number(aantal) || 2), Math.max(2, spelers.length)));
    const teams = [];
    for (const naam of [...namen, ...TEAMNAMEN]) {
        const schoon = String(naam || '').trim().slice(0, 24);
        if (schoon && !teams.includes(schoon)) teams.push(schoon);
        if (teams.length === n) break;
    }
    const bekend = spelers.map((s) => Number(s.sterkte)).filter((x) => Number.isFinite(x));
    const midden = bekend.length ? bekend.sort((a, b) => a - b)[Math.floor(bekend.length / 2)] : 0;
    const sterkte = (s) => (Number.isFinite(Number(s.sterkte)) ? Number(s.sterkte) : midden);

    const stand = teams.map((naam) => ({ naam, leden: 0, kracht: 0, groepen: {} }));
    const indeling = {};
    const plaats = (speler, groep) => {
        const doel = [...stand].sort((a, b) =>
            a.leden - b.leden ||
            (a.groepen[groep] || 0) - (b.groepen[groep] || 0) ||
            a.kracht - b.kracht)[0];
        doel.leden++;
        doel.kracht += sterkte(speler);
        doel.groepen[groep] = (doel.groepen[groep] || 0) + 1;
        indeling[speler.id] = doel.naam;
    };
    // Willekeur bij gelijke sterkte, zodat dezelfde groep niet elke keer
    // exact dezelfde teams krijgt.
    const gehusseld = [...spelers].sort(() => Math.random() - 0.5);
    const opSterkte = (a, b) => sterkte(b) - sterkte(a);
    for (const groep of ['kind', 'senior']) {
        gehusseld.filter((s) => leeftijdsGroep(s.leeftijd) === groep).sort(opSterkte).forEach((s) => plaats(s, groep));
    }
    gehusseld.filter((s) => !['kind', 'senior'].includes(leeftijdsGroep(s.leeftijd)))
        .sort(opSterkte).forEach((s) => plaats(s, leeftijdsGroep(s.leeftijd)));
    return { teams, indeling };
}

module.exports = { verdeelEerlijk, leeftijdsGroep, TEAMNAMEN };
