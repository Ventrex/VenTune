// =====================================================================
// Discord-webhook voor operationele meldingen (crash, DB-fout, nieuwe
// lobby). Volledig optioneel: zonder DISCORD_WEBHOOK_URL doet dit niets
// en blijft de app gewoon werken.
// =====================================================================

const logger = require('./logger');

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

/**
 * Stuur een melding naar Discord. Faalt stil (alleen loggen) zodat een
 * webhookprobleem nooit de app kan laten crashen.
 *
 * @param {string} bericht  De tekst van de melding.
 * @param {object} [opties] { titel, kleur } voor een embed.
 */
async function meld(bericht, opties = {}) {
    if (!WEBHOOK_URL) return; // Meldingen uitgeschakeld.

    const payload = {
        username: 'VenTune',
        embeds: [
            {
                title: opties.titel || 'VenTune',
                description: bericht,
                color: opties.kleur ?? 0xc41230, // Donkerrood, past bij het thema.
                timestamp: new Date().toISOString(),
            },
        ],
    };

    try {
        const resp = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            logger.waarschuwing('Discord-webhook gaf een foutstatus.', {
                status: resp.status,
            });
        }
    } catch (err) {
        logger.waarschuwing('Discord-melding kon niet verstuurd worden.', {
            melding: err.message,
        });
    }
}

module.exports = { meld };
