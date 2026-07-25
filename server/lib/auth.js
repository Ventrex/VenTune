// Host-authenticatie voor VenTune.
//
// Spelers blijven gasten: zij hebben alleen een lobbycode en naam nodig.
// Een host moet wel ingelogd zijn voordat een lobby kan worden aangemaakt.
// Het admin-account blijft een los ADMIN_PASSWORD uit .env en gebruikt deze
// gebruikersdatabase niet.

const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { pool } = require('../db/pool');
const cookies = require('./cookies');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'ventune_host_session';
const MAX_AGE = 30 * 24 * 60 * 60;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function secureCookie() {
    return (process.env.APP_URL || '').startsWith('https://');
}

function schoonGebruikersnaam(waarde) {
    return String(waarde || '').trim().toLowerCase();
}

function valideerGebruikersnaam(waarde) {
    const naam = schoonGebruikersnaam(waarde);
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(naam)) {
        throw new Error('Gebruikersnaam: 3–32 letters, cijfers, punt, streepje of underscore.');
    }
    return naam;
}

function valideerWachtwoord(waarde) {
    const wachtwoord = String(waarde || '');
    if (wachtwoord.length < 10) {
        throw new Error('Kies een wachtwoord van minimaal 10 tekens.');
    }
    if (wachtwoord.length > 200) {
        throw new Error('Wachtwoord is te lang.');
    }
    return wachtwoord;
}

function valideerDisplayNaam(waarde, fallback) {
    const naam = String(waarde || fallback || '').trim().slice(0, 40);
    if (!naam) throw new Error('Vul een zichtbare hostnaam in.');
    return naam;
}

async function hashWachtwoord(wachtwoord) {
    const salt = crypto.randomBytes(16);
    const sleutel = await scrypt(wachtwoord, salt, 64, SCRYPT_OPTS);
    return `scrypt$${salt.toString('base64url')}$${Buffer.from(sleutel).toString('base64url')}`;
}

async function controleerWachtwoord(wachtwoord, opgeslagen) {
    const delen = String(opgeslagen || '').split('$');
    if (delen.length !== 3 || delen[0] !== 'scrypt') return false;
    try {
        const salt = Buffer.from(delen[1], 'base64url');
        const verwacht = Buffer.from(delen[2], 'base64url');
        const gekregen = Buffer.from(await scrypt(wachtwoord, salt, verwacht.length, SCRYPT_OPTS));
        return gekregen.length === verwacht.length && crypto.timingSafeEqual(gekregen, verwacht);
    } catch {
        return false;
    }
}

function tokenHash(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function zetCookie(res, token) {
    res.setHeader('Set-Cookie', cookies.serialiseer(COOKIE, token, {
        httpOnly: true,
        secure: secureCookie(),
        sameSite: 'Lax',
        maxAge: MAX_AGE,
    }));
}

function wisCookie(res) {
    res.setHeader('Set-Cookie', cookies.serialiseer(COOKIE, '', {
        httpOnly: true,
        secure: secureCookie(),
        sameSite: 'Lax',
        maxAge: 0,
    }));
}

function publiekeGebruiker(rij) {
    if (!rij) return null;
    return {
        id: rij.id,
        gebruikersnaam: rij.gebruikersnaam,
        display_naam: rij.display_naam,
    };
}

async function maakSessie(gebruikerId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO auth_sessies (gebruiker_id, token_hash, verloopt_op)
         VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
        [gebruikerId, tokenHash(token), MAX_AGE],
    );
    return token;
}

async function gebruikerUitRequest(req) {
    const jar = cookies.parse(req.headers.cookie);
    const token = jar[COOKIE];
    if (!token) return null;
    const { rows } = await pool.query(
        `SELECT g.id, g.gebruikersnaam, g.display_naam
           FROM auth_sessies s
           JOIN gebruikers g ON g.id = s.gebruiker_id
          WHERE s.token_hash = $1
            AND s.verloopt_op > now()
            AND g.actief = true
          LIMIT 1`,
        [tokenHash(token)],
    );
    if (!rows[0]) return null;
    await pool.query(
        `UPDATE auth_sessies SET laatst_gezien = now() WHERE token_hash = $1`,
        [tokenHash(token)],
    );
    return publiekeGebruiker(rows[0]);
}

async function vereisHost(req, res, next) {
    try {
        const gebruiker = await gebruikerUitRequest(req);
        if (!gebruiker) return res.status(401).json({ fout: 'Log eerst in als host.' });
        req.gebruiker = gebruiker;
        return next();
    } catch {
        return res.status(503).json({ fout: 'Hostsessie kon niet worden gecontroleerd.' });
    }
}

const router = express.Router();

router.get('/api/auth/session', async (req, res) => {
    try {
        const gebruiker = await gebruikerUitRequest(req);
        res.json({ ingelogd: !!gebruiker, gebruiker });
    } catch {
        res.status(503).json({ fout: 'Account kon niet worden gecontroleerd.' });
    }
});

router.post('/api/auth/register', async (req, res) => {
    try {
        const gebruikersnaam = valideerGebruikersnaam(req.body?.gebruikersnaam);
        const wachtwoord = valideerWachtwoord(req.body?.wachtwoord);
        const displayNaam = valideerDisplayNaam(req.body?.display_naam, gebruikersnaam);
        const hash = await hashWachtwoord(wachtwoord);
        const { rows } = await pool.query(
            `INSERT INTO gebruikers
                (gebruikersnaam, gebruikersnaam_norm, display_naam, wachtwoord_hash)
             VALUES ($1, $1, $2, $3)
             RETURNING id, gebruikersnaam, display_naam`,
            [gebruikersnaam, displayNaam, hash],
        );
        const token = await maakSessie(rows[0].id);
        zetCookie(res, token);
        res.status(201).json({ ingelogd: true, gebruiker: publiekeGebruiker(rows[0]) });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ fout: 'Deze gebruikersnaam bestaat al.' });
        res.status(400).json({ fout: err.message || 'Registreren mislukt.' });
    }
});

router.post('/api/auth/login', async (req, res) => {
    try {
        const gebruikersnaam = valideerGebruikersnaam(req.body?.gebruikersnaam);
        const wachtwoord = String(req.body?.wachtwoord || '');
        const { rows } = await pool.query(
            `SELECT id, gebruikersnaam, display_naam, wachtwoord_hash
               FROM gebruikers
              WHERE gebruikersnaam_norm = $1 AND actief = true
              LIMIT 1`,
            [gebruikersnaam],
        );
        if (!rows[0] || !(await controleerWachtwoord(wachtwoord, rows[0].wachtwoord_hash))) {
            return res.status(401).json({ fout: 'Gebruikersnaam of wachtwoord klopt niet.' });
        }
        await pool.query(`UPDATE gebruikers SET laatst_ingelogd = now() WHERE id = $1`, [rows[0].id]);
        const token = await maakSessie(rows[0].id);
        zetCookie(res, token);
        res.json({ ingelogd: true, gebruiker: publiekeGebruiker(rows[0]) });
    } catch (err) {
        res.status(400).json({ fout: err.message || 'Inloggen mislukt.' });
    }
});

router.post('/api/auth/logout', async (req, res) => {
    const jar = cookies.parse(req.headers.cookie);
    if (jar[COOKIE]) {
        await pool.query(`DELETE FROM auth_sessies WHERE token_hash = $1`, [tokenHash(jar[COOKIE])]);
    }
    wisCookie(res);
    res.json({ ok: true });
});

module.exports = {
    router,
    vereisHost,
    gebruikerUitRequest,
    hashWachtwoord,
    controleerWachtwoord,
    valideerWachtwoord,
};
