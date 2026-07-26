// =====================================================================
// Lobby-manager: aanmaken, joinen en herstel na disconnect.
//
// De server is de bron van waarheid. Lobbies, spelers en scores staan in
// de database, zodat een speler die de app sluit en terugkomt met zijn
// sessie-token terug in de lobby valt zonder punten te verliezen.
// =====================================================================

const crypto = require('crypto');
const { pool } = require('../db/pool');

// Codealfabet zonder verwarrende tekens (geen I, O, 0, 1).
const ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTE = 4;

function genereerCode() {
    let code = '';
    const bytes = crypto.randomBytes(CODE_LENGTE);
    for (let i = 0; i < CODE_LENGTE; i++) {
        code += ALFABET[bytes[i] % ALFABET.length];
    }
    return code;
}

function maakToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Maak een nieuwe lobby aan met een unieke code en een host-speler.
 * @returns {Promise<{code, lobbyId, hostSpelerId, hostToken}>}
 */
async function maakLobby({ hostNaam = 'Host', gebruikerId, instellingen = {} } = {}) {
    if (!gebruikerId) throw new Error('Een hostaccount is verplicht.');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Unieke code zoeken (botsingskans is klein, maar we checken).
        let code;
        for (let poging = 0; poging < 20; poging++) {
            code = genereerCode();
            const { rows } = await client.query(
                `SELECT 1 FROM lobbies
                  WHERE code = $1 AND status <> 'afgelopen'`,
                [code],
            );
            if (rows.length === 0) break;
            code = null;
        }
        if (!code) throw new Error('Kon geen vrije lobbycode vinden.');

        const lobby = await client.query(
            `INSERT INTO lobbies (code, status, instellingen, host_gebruiker_id)
             VALUES ($1, 'wachten', $2::jsonb, $3)
             RETURNING id`,
            [code, JSON.stringify(instellingen), gebruikerId],
        );
        const lobbyId = lobby.rows[0].id;

        const hostToken = maakToken();
        const speler = await client.query(
            `INSERT INTO spelers (lobby_id, gebruiker_id, naam, is_host, is_gast, sessie_token, verbonden)
             VALUES ($1, $2, $3, true, false, $4, true)
             RETURNING id`,
            [lobbyId, gebruikerId, hostNaam, hostToken],
        );
        const hostSpelerId = speler.rows[0].id;

        await client.query(
            `UPDATE lobbies SET host_speler_id = $1 WHERE id = $2`,
            [hostSpelerId, lobbyId],
        );

        await client.query('COMMIT');
        return { code, lobbyId, hostSpelerId, hostToken };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/** Haal een lobby op via code (alleen niet-afgelopen). */
async function haalLobby(code) {
    const { rows } = await pool.query(
        `SELECT * FROM lobbies
          WHERE code = $1 AND status <> 'afgelopen'
          LIMIT 1`,
        [String(code || '').toUpperCase()],
    );
    return rows[0] || null;
}

/**
 * Laat een speler meedoen aan een lobby.
 * @returns {Promise<{spelerId, token, lobbyId}>}
 */
async function doeMee({ code, naam, leeftijd = null }) {
    const schoneNaam = String(naam || '').trim().slice(0, 24);
    if (!schoneNaam) throw new Error('Geef een naam op.');
    const leeftijdGetal = leeftijd === null || leeftijd === '' || leeftijd === undefined
        ? null
        : Number(leeftijd);
    if (leeftijdGetal !== null && (!Number.isInteger(leeftijdGetal) || leeftijdGetal < 4 || leeftijdGetal > 120)) {
        throw new Error('Leeftijd moet tussen 4 en 120 jaar liggen.');
    }

    const lobby = await haalLobby(code);
    if (!lobby) throw new Error('Deze lobby bestaat niet (meer).');
    if (lobby.status !== 'wachten') {
        throw new Error('Dit spel is al begonnen.');
    }

    const token = maakToken();
    const { rows } = await pool.query(
        `INSERT INTO spelers (lobby_id, naam, leeftijd, sessie_token, verbonden)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [lobby.id, schoneNaam, leeftijdGetal, token],
    );
    return { spelerId: rows[0].id, token, lobbyId: lobby.id };
}

/** Lijst met spelers in een lobby (voor de spelerslijst). */
async function haalSpelers(lobbyId) {
    const { rows } = await pool.query(
        `SELECT id, naam, is_host, verbonden, score, leeftijd, team_naam
           FROM spelers
          WHERE lobby_id = $1
          ORDER BY is_host DESC, aangemaakt_op ASC`,
        [lobbyId],
    );
    return rows;
}

/**
 * Zoek een speler op sessie-token en markeer verbonden/afwezig.
 * Gebruikt bij (her)verbinden en disconnect. Geeft de spelerrij terug.
 */
async function zetVerbonden(token, verbonden) {
    if (!token) return null;
    const { rows } = await pool.query(
        `UPDATE spelers SET verbonden = $2
          WHERE sessie_token = $1
          RETURNING id, lobby_id, naam, is_host, score`,
        [token, verbonden],
    );
    return rows[0] || null;
}

/** Speler ophalen via token (voor herstel), inclusief lobbycode. */
async function haalSpelerViaToken(token) {
    if (!token) return null;
    const { rows } = await pool.query(
        `SELECT s.id, s.lobby_id, s.naam, s.is_host, s.score, s.team_naam,
                l.code, l.status, l.instellingen
           FROM spelers s
           JOIN lobbies l ON l.id = s.lobby_id
          WHERE s.sessie_token = $1
            AND l.status <> 'afgelopen'
          LIMIT 1`,
        [token],
    );
    return rows[0] || null;
}

async function bewaarInstellingen(lobbyId, instellingen) {
    const lobby = await haalLobbyViaId(lobbyId);
    if (!lobby || lobby.status !== 'wachten') throw new Error('De lobby kan niet meer worden aangepast.');
    const veilig = { ...(lobby.instellingen || {}), ...(instellingen || {}) };
    if (Array.isArray(veilig.teams)) {
        veilig.teams = [...new Set(veilig.teams.map((t) => String(t).trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
    }
    await pool.query(`UPDATE lobbies SET instellingen = $2::jsonb, bijgewerkt_op = now() WHERE id = $1`, [lobbyId, JSON.stringify(veilig)]);
    return veilig;
}

async function haalLobbyViaId(lobbyId) {
    const { rows } = await pool.query(`SELECT id, status, instellingen FROM lobbies WHERE id = $1 LIMIT 1`, [lobbyId]);
    return rows[0] || null;
}

async function zetTeam({ lobbyId, spelerId, teamNaam }) {
    const lobby = await haalLobbyViaId(lobbyId);
    if (!lobby || lobby.status !== 'wachten') throw new Error('Teams kunnen alleen in de lobby worden aangepast.');
    const naam = teamNaam ? String(teamNaam).trim().slice(0, 24) : null;
    const teams = Array.isArray(lobby.instellingen?.teams) ? lobby.instellingen.teams : [];
    if (naam && !teams.includes(naam)) throw new Error('Kies eerst een bestaand team.');
    await pool.query(`UPDATE spelers SET team_naam = $3 WHERE id = $1 AND lobby_id = $2`, [spelerId, lobbyId, naam]);
    return naam;
}

module.exports = {
    maakLobby,
    haalLobby,
    doeMee,
    haalSpelers,
    zetVerbonden,
    haalSpelerViaToken,
    bewaarInstellingen,
    zetTeam,
    genereerCode,
};
