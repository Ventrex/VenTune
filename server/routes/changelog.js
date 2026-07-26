// =====================================================================
// Publieke changelog voor spelers.
// De bron blijft CHANGELOG.md in de repository; de client krijgt alleen een
// eenvoudige, veilige JSON-weergave en hoeft geen Markdown te renderen.
// =====================================================================

const fs = require('fs');
const path = require('path');
const express = require('express');

const router = express.Router();
const PAD = path.join(__dirname, '../../CHANGELOG.md');

function leesChangelog() {
    const markdown = fs.readFileSync(PAD, 'utf8');
    const regels = markdown.split(/\r?\n/);
    const entries = [];
    let huidig = null;
    let sectie = null;

    for (const regel of regels) {
        const versie = regel.match(/^##\s+\[?([^\]\s]+)\]?\s*(?:[-–]\s*(.*))?$/);
        if (versie) {
            huidig = {
                versie: versie[1],
                datum: versie[2] || '',
                secties: [],
            };
            entries.push(huidig);
            sectie = null;
            continue;
        }
        const kop = regel.match(/^###\s+(.+)$/);
        if (kop && huidig) {
            const titel = kop[1].trim();
            const klein = titel.toLowerCase();
            const doelgroep = /admin|beheer/.test(klein)
                ? 'admin'
                : /betrouwbaarheid|veiligheid/.test(klein)
                  ? 'host'
                  : 'spelers';
            sectie = { titel, doelgroep, punten: [] };
            huidig.secties.push(sectie);
            continue;
        }
        const punt = regel.match(/^[-*]\s+(.+)$/);
        if (punt && sectie) sectie.punten.push(punt[1].trim());
    }
    return entries;
}

router.get('/api/changelog', (req, res) => {
    try {
        const doelgroep = String(req.query.doelgroep || 'publiek');
        const entries = leesChangelog().map((entry) => ({
            ...entry,
            secties: entry.secties.filter((sectie) => doelgroep === 'alles'
                ? true
                : doelgroep === 'admin'
                  ? sectie.doelgroep === 'admin'
                  : sectie.doelgroep !== 'admin'),
        })).filter((entry) => entry.secties.length > 0);
        res.json({ entries });
    } catch {
        res.status(500).json({ fout: 'Changelog kon niet worden geladen.' });
    }
});

module.exports = router;
