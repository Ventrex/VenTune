// Zet pas na menselijke goedkeuring een tijdelijke MP3 in de definitieve categoriemap.
// Bestanden van oudere versies buiten _Tijdelijk blijven ongemoeid.
const fs = require('fs/promises');
const path = require('path');
const MAPPEN = new Set(['Film', 'Serie', 'Videogames', 'Muziek', 'Kerst', 'Sinterklaas', 'Kinder', 'Manga']);

async function publiceerMp3(webpad, mediaDir = process.env.MEDIA_DIR || '/media') {
    const prefix = '/media/_Tijdelijk/';
    if (!String(webpad || '').startsWith(prefix)) return null;
    const deel = webpad.slice(prefix.length).split('/');
    if (deel.length !== 2 || !MAPPEN.has(deel[0]) || !deel[1] ||
        deel[1] === '.' || deel[1] === '..' || /[\\/]/.test(deel[1]) || !/\.mp3$/i.test(deel[1])) {
        throw new Error('Ongeldig tijdelijk MP3-pad; handmatige controle vereist.');
    }
    const [categorie, bestand] = deel;
    const bron = path.join(mediaDir, '_Tijdelijk', categorie, bestand);
    const doel = path.join(mediaDir, categorie, bestand);
    await fs.mkdir(path.dirname(doel), { recursive: true });
    // Bestaande bestanden nooit overschrijven; elke kandidaat heeft een unieke track-id.
    try {
        await fs.stat(doel);
        throw new Error('MP3-bestand bestaat al op definitieve locatie.');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    await fs.rename(bron, doel);
    return { url: '/media/' + categorie + '/' + bestand, bron, doel };
}

async function herstelPublicatie(verplaatsing) {
    if (!verplaatsing) return;
    await fs.mkdir(path.dirname(verplaatsing.bron), { recursive: true });
    await fs.rename(verplaatsing.doel, verplaatsing.bron);
}
module.exports = { publiceerMp3, herstelPublicatie };
