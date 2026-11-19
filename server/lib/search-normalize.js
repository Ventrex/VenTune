// Apostrofs komen voor als ASCII ', typografische ’, ‘ en backtick.
// Eén zoekterm moet alle varianten herkennen, inclusief Assassins Creed.
const APOSTROFS = /['’‘`´]/g;
function normaliseerZoekterm(value) {
    return String(value ?? '').replace(APOSTROFS, '').normalize('NFKC').trim().toLowerCase();
}
// Alleen interne, vaste veldnamen zijn toegestaan; waarden blijven SQL-parameters.
function sqlZoekveld(veld) {
    if (!/^[a-z_]+(?:\.[a-z_]+)?$/.test(veld)) throw new Error('Ongeldig zoekveld');
    return `translate(lower(COALESCE(${veld}, '')), chr(39) || chr(8216) || chr(8217) || chr(96) || chr(180), '')`;
}
module.exports = { normaliseerZoekterm, sqlZoekveld };
