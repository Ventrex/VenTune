// Veilige tekst voor titels en audiometadata.
//
// VenTune is gericht op Nederlandstalige en internationaal bekende titels
// die in Nederland te herkennen zijn. TMDB/iTunes/YouTube kunnen daarnaast
// resultaten teruggeven in Cyrillisch, Arabisch, CJK of andere schriften.
// Die resultaten zijn voor deze catalogus niet bruikbaar en vervuilen ook de
// muziekzoeklijst. We filteren op de tekst zelf, niet op het productieland:
// een Duitse titel die aantoonbaar in de NL-selectie zit mag dus blijven.

const ONGEWENSTE_SCRIPTEN = /[Ѐ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿⺀-鿿가-힯ﭐ-﷿ﹰ-﻿]/u;
const ONGEWENSTE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\ufffd\ue000-\uf8ff\u200b-\u200f\u202a-\u202e]/u;

function veiligeTiteltekst(waarde) {
    const tekst = String(waarde || '').trim();
    if (!tekst) return false;
    if (ONGEWENSTE_SCRIPTEN.test(tekst)) return false;
    if (ONGEWENSTE_CONTROLE.test(tekst)) return false;
    return true;
}

function veiligeMetadata(...waarden) {
    const aanwezige = waarden.map((waarde) => String(waarde || '').trim()).filter(Boolean);
    return aanwezige.length > 0 && aanwezige.every(veiligeTiteltekst);
}

module.exports = { veiligeTiteltekst, veiligeMetadata, ONGEWENSTE_SCRIPTEN };
