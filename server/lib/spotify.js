// =====================================================================
// Spotify-integratie (server-side).
//
// De volledige OAuth 2.0 PKCE-flow draait hier op de server. De browser
// krijgt nooit een client secret en nooit het refresh-token. De server
// bewaart de tokens per sessie in de database en ververst ze proactief,
// ook midden in een spel.
//
// Bevat later ook de playback-commando's (stap 3).
// =====================================================================

const crypto = require('crypto');
const { pool } = require('../db/pool');
const logger = require('./logger');

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com';

// Vereiste scopes voor afspelen én profiel lezen.
const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state',
].join(' ');

// Marge waarmee we een token als "bijna verlopen" beschouwen (5 minuten).
const VERNIEUW_MARGE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------
// PKCE-helpers
// ---------------------------------------------------------------------

function base64url(buffer) {
    return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** Genereer een willekeurige code_verifier (43–128 tekens). */
function maakVerifier() {
    return base64url(crypto.randomBytes(64));
}

/** Bereken de code_challenge (S256) uit een verifier. */
function maakChallenge(verifier) {
    return base64url(crypto.createHash('sha256').update(verifier).digest());
}

/** Willekeurige state-waarde tegen CSRF. */
function maakState() {
    return base64url(crypto.randomBytes(24));
}

/** Nieuw opaak sessie-token voor in de browsercookie. */
function maakSessieToken() {
    return base64url(crypto.randomBytes(32));
}

// ---------------------------------------------------------------------
// Autorisatie-URL
// ---------------------------------------------------------------------

function bouwAutorisatieUrl({ state, codeChallenge }) {
    const params = new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID || '',
        response_type: 'code',
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
        state,
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });
    return `${ACCOUNTS}/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Token-uitwisseling en -vernieuwing
// ---------------------------------------------------------------------

async function wisselCodeIn({ code, codeVerifier }) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
        client_id: process.env.SPOTIFY_CLIENT_ID || '',
        code_verifier: codeVerifier,
    });

    const resp = await fetch(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!resp.ok) {
        const tekst = await resp.text();
        throw new Error(`Token-uitwisseling mislukt (${resp.status}): ${tekst}`);
    }
    return resp.json();
}

async function vernieuwToken(refreshToken) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.SPOTIFY_CLIENT_ID || '',
    });

    const resp = await fetch(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!resp.ok) {
        const tekst = await resp.text();
        throw new Error(`Token-vernieuwing mislukt (${resp.status}): ${tekst}`);
    }
    return resp.json();
}

// ---------------------------------------------------------------------
// Spotify Web API
// ---------------------------------------------------------------------

async function haalProfiel(accessToken) {
    const resp = await fetch(`${API}/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
        const tekst = await resp.text();
        throw new Error(`Profiel ophalen mislukt (${resp.status}): ${tekst}`);
    }
    return resp.json();
}

// ---------------------------------------------------------------------
// Sessie-opslag in de database
// ---------------------------------------------------------------------

/**
 * Sla een nieuwe (of vervangende) sessie op na een geslaagde login.
 * Retourneert het sessie-token voor in de cookie.
 */
async function slaSessieOp({ sessieToken, profiel, tokens }) {
    const verlooptOp = new Date(Date.now() + tokens.expires_in * 1000);
    await pool.query(
        `INSERT INTO spotify_sessies
           (sessie_token, spotify_id, weergavenaam, email, product,
            access_token, refresh_token, verloopt_op)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (sessie_token) DO UPDATE SET
            spotify_id    = EXCLUDED.spotify_id,
            weergavenaam  = EXCLUDED.weergavenaam,
            email         = EXCLUDED.email,
            product       = EXCLUDED.product,
            access_token  = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            verloopt_op   = EXCLUDED.verloopt_op,
            bijgewerkt_op = now()`,
        [
            sessieToken,
            profiel.id,
            profiel.display_name || profiel.id,
            profiel.email || null,
            profiel.product || null,
            tokens.access_token,
            tokens.refresh_token,
            verlooptOp,
        ],
    );
}

async function haalSessie(sessieToken) {
    if (!sessieToken) return null;
    const { rows } = await pool.query(
        `SELECT * FROM spotify_sessies WHERE sessie_token = $1`,
        [sessieToken],
    );
    return rows[0] || null;
}

async function verwijderSessie(sessieToken) {
    if (!sessieToken) return;
    await pool.query(`DELETE FROM spotify_sessies WHERE sessie_token = $1`, [
        sessieToken,
    ]);
}

/**
 * Geef een geldig access token voor een sessie. Ververst automatisch als
 * het token binnen de marge verloopt. Werkt de opgeslagen tokens bij.
 */
async function geldigAccessToken(sessieToken) {
    const sessie = await haalSessie(sessieToken);
    if (!sessie) return null;

    const verlooptMs = new Date(sessie.verloopt_op).getTime();
    if (verlooptMs - Date.now() > VERNIEUW_MARGE_MS) {
        return sessie.access_token; // Nog ruim geldig.
    }

    // Verversen.
    const nieuw = await vernieuwToken(sessie.refresh_token);
    const verlooptOp = new Date(Date.now() + nieuw.expires_in * 1000);
    // Spotify stuurt niet altijd een nieuw refresh_token terug.
    const refresh = nieuw.refresh_token || sessie.refresh_token;

    await pool.query(
        `UPDATE spotify_sessies
            SET access_token = $1, refresh_token = $2, verloopt_op = $3,
                bijgewerkt_op = now()
          WHERE sessie_token = $4`,
        [nieuw.access_token, refresh, verlooptOp, sessieToken],
    );
    logger.info('Spotify-token ververst.', { spotify_id: sessie.spotify_id });
    return nieuw.access_token;
}

// ---------------------------------------------------------------------
// Proactieve achtergrondvernieuwing
// Ververst elke minuut alle sessies die binnen de marge verlopen, zodat
// tokens ook geldig blijven als een speler even niets doet (midden in een
// spel). Access tokens leven ~1 uur; wij grijpen ruim op tijd in.
// ---------------------------------------------------------------------

let intervalHandle = null;

async function vernieuwVerlopendeSessies() {
    try {
        const grens = new Date(Date.now() + VERNIEUW_MARGE_MS);
        const { rows } = await pool.query(
            `SELECT sessie_token, spotify_id, refresh_token
               FROM spotify_sessies
              WHERE verloopt_op <= $1`,
            [grens],
        );
        for (const sessie of rows) {
            try {
                await geldigAccessToken(sessie.sessie_token);
            } catch (err) {
                logger.waarschuwing('Kon sessie niet verversen.', {
                    spotify_id: sessie.spotify_id,
                    melding: err.message,
                });
            }
        }
    } catch (err) {
        logger.waarschuwing('Achtergrondvernieuwing overgeslagen.', {
            melding: err.message,
        });
    }
}

function startAchtergrondVernieuwing() {
    if (intervalHandle) return;
    intervalHandle = setInterval(vernieuwVerlopendeSessies, 60 * 1000);
    // Voorkom dat dit interval het afsluiten tegenhoudt.
    if (intervalHandle.unref) intervalHandle.unref();
    logger.info('Proactieve token-vernieuwing gestart (elke 60s).');
}

function stopAchtergrondVernieuwing() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}

module.exports = {
    SCOPES,
    maakVerifier,
    maakChallenge,
    maakState,
    maakSessieToken,
    bouwAutorisatieUrl,
    wisselCodeIn,
    vernieuwToken,
    haalProfiel,
    slaSessieOp,
    haalSessie,
    verwijderSessie,
    geldigAccessToken,
    startAchtergrondVernieuwing,
    stopAchtergrondVernieuwing,
};
