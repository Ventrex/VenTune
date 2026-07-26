// Controle van blijvende lokale audio. De database mag nooit doen alsof een
// pad beschikbaar is wanneer het bestand uit de Docker-volume is verdwenen.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

function absoluutPad(mediaPad, mediaDir = process.env.MEDIA_DIR || '/media') {
    const waarde = String(mediaPad || '');
    if (!waarde) return null;
    if (waarde.startsWith('/media/')) return path.join(mediaDir, waarde.slice('/media/'.length));
    if (waarde.startsWith('/')) return waarde;
    return path.join(mediaDir, waarde);
}

async function bestandGezondheid(track, opties = {}) {
    const pad = absoluutPad(track?.bestand_pad || track?.preview_url, opties.mediaDir);
    if (!pad) return { aanwezig: false, fout: 'Geen lokaal bestandspad.' };
    try {
        const info = await fs.stat(pad);
        if (!info.isFile() || info.size <= 0) {
            return { aanwezig: false, fout: 'Pad bestaat maar is geen bruikbaar audiobestand.' };
        }
        const hash = crypto.createHash('sha256');
        const bytes = await fs.readFile(pad);
        hash.update(bytes);
        const sha256 = hash.digest('hex');
        return {
            aanwezig: true,
            pad,
            grootte: info.size,
            sha256,
            hashGelijk: !track.audio_sha256 || track.audio_sha256 === sha256,
            fout: track.audio_sha256 && track.audio_sha256 !== sha256
                ? 'SHA-256 wijkt af; bestand is gewijzigd.'
                : null,
        };
    } catch (err) {
        return { aanwezig: false, pad, fout: err.code === 'ENOENT' ? 'Bestand ontbreekt.' : err.message };
    }
}

module.exports = { absoluutPad, bestandGezondheid };
