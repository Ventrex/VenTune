// =====================================================================
// Publieke changelog voor spelers.
// De bron blijft CHANGELOG.md in de repository; de client krijgt alleen een
// eenvoudige, veilige JSON-weergave en hoeft geen Markdown te renderen.
// =====================================================================

const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('../db/pool');

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
        if (punt && huidig && !sectie) {
            // Punten direct onder een versie, zonder ### kopje.
            sectie = { titel: 'Wijzigingen', doelgroep: 'spelers', punten: [] };
            huidig.secties.push(sectie);
        }
        if (punt && sectie) sectie.punten.push(punt[1].trim().replace(/\*\*(.+?)\*\*/g, '$1'));
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

// Database-wijzigingen per dag: "100 nummers toegevoegd bij Videogames".
const CAT = { film: 'Films', serie: 'Series', anime: 'Anime', game: 'Videogames', muziek: 'Muziek' };
const SOORT = { toegevoegd: ['nummer', 'nummers', 'toegevoegd bij'], aangepast: ['titel', 'titels', 'verbeterd bij'], hints: ['titel', 'titels', 'kreeg hints en bonusvragen bij|kregen hints en bonusvragen bij'] };
router.get('/api/changelog/database', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT to_char(datum, 'YYYY-MM-DD') AS datum, categorie, soort, aantal
              FROM database_dagstat
             WHERE datum >= CURRENT_DATE - 60 AND aantal > 0
             ORDER BY datum DESC, CASE soort WHEN 'toegevoegd' THEN 0 WHEN 'hints' THEN 1 ELSE 2 END, aantal DESC`);
        const dagen = [];
        for (const r of rows) {
            if (!SOORT[r.soort] || !CAT[r.categorie]) continue;
            let dag = dagen[dagen.length - 1];
            if (!dag || dag.datum !== r.datum) { dag = { datum: r.datum, regels: [] }; dagen.push(dag); }
            const [een, meer, werk] = SOORT[r.soort];
            const [werkEen, werkMeer] = werk.includes('|') ? werk.split('|') : [werk, werk];
            dag.regels.push(`${r.aantal} ${r.aantal === 1 ? een : meer} ${r.aantal === 1 ? werkEen : werkMeer} ${CAT[r.categorie]}`);
        }
        res.json({ dagen });
    } catch {
        res.json({ dagen: [] });
    }
});

module.exports = router;
