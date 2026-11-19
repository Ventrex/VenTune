// Een gezamenlijke quiz met ruimte voor deelnemers die vooral Nederlandstalige
// muziek herkennen. Geen automatische aannames op basis van iemands leeftijd.
function kiesFamilieMix(titels, voorkeursTitels, gevraagd, profiel) {
    const aantal = Math.max(0, Math.min(titels.length, Number(gevraagd) || titels.length));
    const nl = (t) => (String(t.taal) === 'nl' || t.nl_versie === true) &&
        t.nl_bekend !== 'nee' &&
        (!t.bekendheid_tier || ['iconisch', 'algemeen_bekend', 'bekend'].includes(t.bekendheid_tier));
    const vasteNl = profiel === 'familie' ? Math.min(
        Math.ceil(aantal / 3), titels.filter(nl).length
    ) : 0;
    const gepakt = [];
    const ids = new Set();
    const voeg = (lijst, max) => {
        for (const item of lijst) {
            if (gepakt.length >= aantal || max <= 0) break;
            if (ids.has(item.id)) continue;
            gepakt.push(item);
            ids.add(item.id);
            max--;
        }
    };
    voeg(titels.filter(nl), vasteNl);
    // Alle spelers krijgen waar mogelijk hun eigen specialiteiten.
    voeg(voorkeursTitels, Math.max(0, Math.ceil(aantal * 0.35) - gepakt.length));
    voeg(titels, aantal - gepakt.length);
    return { gekozen: gepakt, nederlandsMinimaal: vasteNl };
}
module.exports = { kiesFamilieMix };
