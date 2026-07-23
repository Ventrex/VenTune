// =====================================================================
// Auth-routes: Spotify OAuth 2.0 PKCE (server-side).
//
//   GET  /auth/login          → redirect naar Spotify
//   GET  /auth/callback       → wisselt code in, zet sessie-cookie
//   POST /auth/logout         → wist de sessie
//   GET  /api/me              → huidig profiel (of 401)
//   GET  /api/spotify/token   → geldig access token voor de Web Playback SDK
//
// De PKCE code_verifier leeft kort in het geheugen, gekoppeld aan de
// state-waarde. Zo blijft er geen enkel geheim in de browser.
// =====================================================================

const express = require('express');
const spotify = require('../lib/spotify');
const cookies = require('../lib/cookies');
const logger = require('../lib/logger');
const discord = require('../lib/discord');

const router = express.Router();

const COOKIE_NAAM = 'ventune_sessie';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 dagen
const HTTPS = (process.env.APP_URL || '').startsWith('https');

// Kortstondige opslag van PKCE-verifiers, gekoppeld aan state.
// Vervalt na 10 minuten om lekken te voorkomen.
const openLogins = new Map(); // state -> { verifier, tijd }

function ruimOudeLoginsOp() {
    const grens = Date.now() - 10 * 60 * 1000;
    for (const [state, item] of openLogins) {
        if (item.tijd < grens) openLogins.delete(state);
    }
}

function leesSessieToken(req) {
    const jar = cookies.parse(req.headers.cookie);
    return jar[COOKIE_NAAM] || null;
}

// ---------------------------------------------------------------------
// GET /auth/login — start de flow
// ---------------------------------------------------------------------
router.get('/auth/login', (req, res) => {
    if (!process.env.SPOTIFY_CLIENT_ID) {
        return res
            .status(500)
            .json({ fout: 'SPOTIFY_CLIENT_ID ontbreekt in de serverconfiguratie.' });
    }
    ruimOudeLoginsOp();

    const state = spotify.maakState();
    const verifier = spotify.maakVerifier();
    const challenge = spotify.maakChallenge(verifier);
    openLogins.set(state, { verifier, tijd: Date.now() });

    const url = spotify.bouwAutorisatieUrl({ state, codeChallenge: challenge });
    res.redirect(url);
});

// ---------------------------------------------------------------------
// GET /auth/callback — Spotify komt hier terug
// ---------------------------------------------------------------------
router.get('/auth/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        logger.waarschuwing('Spotify-login geweigerd.', { error });
        return res.redirect('/?login=geweigerd');
    }
    const item = state ? openLogins.get(state) : null;
    if (!code || !item) {
        return res.redirect('/?login=mislukt');
    }
    openLogins.delete(state);

    try {
        const tokens = await spotify.wisselCodeIn({
            code,
            codeVerifier: item.verifier,
        });
        const profiel = await spotify.haalProfiel(tokens.access_token);

        const sessieToken = spotify.maakSessieToken();
        await spotify.slaSessieOp({ sessieToken, profiel, tokens });

        res.setHeader(
            'Set-Cookie',
            cookies.serialiseer(COOKIE_NAAM, sessieToken, {
                httpOnly: true,
                secure: HTTPS,
                sameSite: 'Lax',
                maxAge: COOKIE_MAX_AGE,
            }),
        );

        logger.info('Speler ingelogd via Spotify.', {
            spotify_id: profiel.id,
            product: profiel.product,
        });
        res.redirect('/?login=ok');
    } catch (err) {
        logger.fout('Spotify-callback mislukt.', { melding: err.message });
        await discord.meld(`Spotify-login mislukt: ${err.message}`, {
            titel: '🔴 VenTune login',
        });
        res.redirect('/?login=fout');
    }
});

// ---------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------
router.post('/auth/logout', async (req, res) => {
    const token = leesSessieToken(req);
    await spotify.verwijderSessie(token);
    res.setHeader(
        'Set-Cookie',
        cookies.serialiseer(COOKIE_NAAM, '', {
            httpOnly: true,
            secure: HTTPS,
            sameSite: 'Lax',
            maxAge: 0,
        }),
    );
    res.json({ ok: true });
});

// ---------------------------------------------------------------------
// GET /api/me — huidig profiel
// ---------------------------------------------------------------------
router.get('/api/me', async (req, res) => {
    const token = leesSessieToken(req);
    const sessie = await spotify.haalSessie(token);
    if (!sessie) {
        return res.status(401).json({ ingelogd: false });
    }
    const isPremium = sessie.product === 'premium';
    res.json({
        ingelogd: true,
        spotify_id: sessie.spotify_id,
        weergavenaam: sessie.weergavenaam,
        email: sessie.email,
        product: sessie.product,
        // Zonder Premium kun je geen host zijn en speel je als gast mee.
        is_premium: isPremium,
        kan_afspelen: isPremium,
    });
});

// ---------------------------------------------------------------------
// GET /api/spotify/token — geldig access token voor de Web Playback SDK
// (alleen het eigen token van de ingelogde speler; nooit dat van anderen)
// ---------------------------------------------------------------------
router.get('/api/spotify/token', async (req, res) => {
    const token = leesSessieToken(req);
    try {
        const access = await spotify.geldigAccessToken(token);
        if (!access) return res.status(401).json({ fout: 'Niet ingelogd.' });
        res.json({ access_token: access });
    } catch (err) {
        logger.fout('Token ophalen mislukt.', { melding: err.message });
        res.status(502).json({ fout: 'Kon Spotify-token niet vernieuwen.' });
    }
});

module.exports = router;
