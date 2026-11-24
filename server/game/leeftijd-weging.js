// =====================================================================
// Vragen afstemmen op de leeftijden aan tafel.
//
// Iedereen heeft een "jeugd": de jaren waarin je tussen ongeveer 6 en 25
// was. Muziek, films en series uit die jaren herken je het best. Een titel
// die in iemands jeugd valt, krijgt een iets grotere kans. Kinderen en
// senioren tellen zwaarder mee, zodat zij vaker een nummer krijgen dat zij
// kennen (de middengroep kent toch al het meeste).
//
// Het is een kans, geen filter: alle titels kunnen nog steeds voorbijkomen.
// =====================================================================

const KIND_TOT = 12;
const SENIOR_VANAF = 60;

function titelJaar(titel) {
    const jaar = Number(titel?.muziek_jaar || titel?.jaar);
    return Number.isInteger(jaar) && jaar > 1900 ? jaar : null;
}

function jeugdVenster(leeftijd, nu = new Date().getFullYear()) {
    const l = Number(leeftijd);
    if (!Number.isFinite(l) || l < 4) return null;
    const geboren = nu - l;
    // Kinderen: wat ze nu kennen (laatste jaren) plus de klassiekers die
    // kinderen altijd kennen via categorie 'kinder'/'sinterklaas'.
    if (l <= KIND_TOT) return { van: geboren + 2, tot: nu };
    return { van: geboren + 6, tot: geboren + 25 };
}

/** Gewicht ≥ 1 voor één titel, gegeven de leeftijden van de spelers. */
function leeftijdGewicht(titel, leeftijden, nu = new Date().getFullYear()) {
    const geldig = (leeftijden || []).map(Number).filter((l) => Number.isFinite(l) && l >= 4);
    if (!geldig.length) return 1;
    const jaar = titelJaar(titel);
    const cat = titel?.categorie || titel?.type;
    let extra = 0;
    for (const l of geldig) {
        const venster = jeugdVenster(l, nu);
        const zwaar = l <= KIND_TOT || l >= SENIOR_VANAF;
        let past = !!(venster && jaar && jaar >= venster.van && jaar <= venster.tot);
        if (l <= KIND_TOT && ['kinder', 'sinterklaas', 'kerst'].includes(cat)) past = true;
        if (past) extra += zwaar ? 1.0 : 0.35;
    }
    // Gemiddeld per speler, begrensd: hooguit 2,2× zo veel kans.
    return 1 + Math.min(1.2, extra / geldig.length * 1.6);
}

/**
 * Gewogen willekeurige volgorde (Efraimidis–Spirakis). `basis` mag een
 * bestaand gewicht per titel geven (bijv. afwaardering bij onherkenbaar).
 */
function wegingsVolgorde(titels, leeftijden, basis = () => 1, nu = new Date().getFullYear()) {
    return titels.map((t) => {
        const w = Math.max(0.05, basis(t) * leeftijdGewicht(t, leeftijden, nu));
        return { t, s: Math.pow(Math.random(), 1 / w) };
    }).sort((a, b) => b.s - a.s).map((x) => x.t);
}

module.exports = { leeftijdGewicht, wegingsVolgorde, jeugdVenster, titelJaar };
