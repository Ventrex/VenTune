// =====================================================================
// Audio-proxy. Streamt iTunes-preview-clips via onze eigen server, zodat
// de client ze same-origin en over https binnenkrijgt. Dit lost het op
// dat iOS Safari externe/mixed-content media weigert af te spelen.
//
//   GET /api/audio?src=<iTunes-URL>
//
// Alleen Apple-hosts zijn toegestaan (geen open proxy → geen SSRF). Range-
// verzoeken worden doorgegeven zodat scrubben/streaming blijft werken.
// =====================================================================

const express = require('express');
const { Readable } = require('stream');
const logger = require('../lib/logger');

const router = express.Router();

function toegestaneHost(hostname) {
    const h = hostname.toLowerCase();
    return (
        h.endsWith('.mzstatic.com') ||
        h.endsWith('itunes.apple.com') ||
        h.endsWith('.apple.com')
    );
}

router.get('/api/audio', async (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ fout: 'src ontbreekt.' });

    let doel;
    try {
        doel = new URL(String(src));
    } catch {
        return res.status(400).json({ fout: 'Ongeldige URL.' });
    }
    if (!toegestaneHost(doel.hostname)) {
        return res.status(403).json({ fout: 'Host niet toegestaan.' });
    }
    // Altijd via https ophalen (voorkomt mixed content).
    doel.protocol = 'https:';

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    let upstream;
    try {
        upstream = await fetch(doel.toString(), { headers });
    } catch (err) {
        logger.waarschuwing('Audio-proxy: upstream onbereikbaar.', {
            melding: err.message,
        });
        return res.status(502).json({ fout: 'Kon de clip niet ophalen.' });
    }

    res.status(upstream.status);
    for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
        'etag',
        'last-modified',
    ]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
    }
    // Toestaan dat de client de clip in een audio-element gebruikt.
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
});

module.exports = router;
