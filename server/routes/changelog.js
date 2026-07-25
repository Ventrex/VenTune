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
            sectie = { titel: kop[1].trim(), punten: [] };
            huidig.secties.push(sectie);
            continue;
        }
        const punt = regel.match(/^[-*]\s+(.+)$/);
        if (punt && sectie) sectie.punten.push(punt[1].trim());
    }
    return entries;
}

router.get('/api/changelog', (_req, res) => {
    try {
        res.json({ entries: leesChangelog() });
    } catch {
        res.status(500).json({ fout: 'Changelog kon niet worden geladen.' });
    }
});

module.exports = router;
