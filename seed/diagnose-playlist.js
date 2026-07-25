// =====================================================================
// Diagnose voor playlists. Laat zien wat YouTube precies terugstuurt en
// welke video-objecten erin zitten. Handig als de playlist-import 0
// video's vindt: dan weten we of het een cookiemuur is, een gewijzigde
// paginaopbouw, of iets anders.
//
// Gebruik:
//   node /app/seed/diagnose-playlist.js
//   node /app/seed/diagnose-playlist.js PLxxxxxxxx
// =====================================================================

const fs = require('fs');
const path = require('path');
const ytzoek = require('../server/lib/ytzoek');

async function main() {
    const opgegeven = process.argv[2];
    let ids;
    if (opgegeven) {
        ids = [{ naam: 'opgegeven playlist', id: opgegeven }];
    } else {
        const lijst = JSON.parse(
            fs.readFileSync(path.join(__dirname, 'playlists.json'), 'utf8'),
        );
        ids = lijst.slice(0, 2); // eerste twee is genoeg voor een diagnose
    }

    for (const pl of ids) {
        console.log(`\n=== ${pl.naam} (${pl.id}) ===`);
        let html;
        try {
            html = await ytzoek.haalPlaylistHtml(pl.id);
        } catch (err) {
            console.log(`Ophalen mislukt: ${err.message}`);
            continue;
        }

        const info = ytzoek.inspecteerPagina(html);
        console.log(`HTML-lengte:            ${info.htmlLengte}`);
        console.log(`ytInitialData gevonden: ${info.ytInitialDataGevonden}`);
        console.log(`"videoId" in HTML:      ${info.videoIdVoorkomens}`);
        console.log(`"contentId" in HTML:    ${info.contentIdVoorkomens}`);
        console.log(`Cookiemuur:             ${info.cookiemuur}`);

        const sleutels = Object.entries(info.sleutels)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12);
        if (sleutels.length) {
            console.log('Meest voorkomende objecten:');
            for (const [naam, n] of sleutels) {
                console.log(`   ${naam}: ${n}`);
            }
        }

        const items = ytzoek.leesPlaylistItems(html);
        console.log(`\nUitgelezen video's: ${items.length}`);
        for (const v of items.slice(0, 8)) {
            console.log(`   • ${v.titel}  [${v.videoId}]`);
        }

        if (items.length === 0) {
            console.log(
                '\nGeen video\'s gelezen. Stuur de regels hierboven door, dan kan de\n' +
                    'parser op de juiste structuur worden aangepast.',
            );
        }
    }
}

main().catch((err) => {
    console.error('Diagnose mislukt:', err.message);
    process.exit(1);
});
