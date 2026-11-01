import React, { useState } from 'react';

// Compacte melding voor muziek én inhoud. Bestaande meldingen/adminlijst blijven bruikbaar.
const CATEGORIES = [
    ['geen_geluid', 'Geen geluid', false],
    ['gek_geluid', 'Gek/krakend geluid', false],
    ['verkeerd_nummer', 'Verkeerd nummer', true],
    ['poster', 'Verkeerde of ontbrekende poster', true],
    ['titel', 'Verkeerde titel', true],
    ['jaartal', 'Verkeerd jaartal', true],
    ['hint', 'Hint klopt niet', true],
    ['vraag', 'Vraag of antwoord klopt niet', true],
    ['overig', 'Overig', false],
];

export default function IssueReport({ spel, tijdensRonde = false }) {
    const [open, setOpen] = useState(false);
    const [categorie, setCategorie] = useState('geen_geluid');
    const [correctie, setCorrectie] = useState('');
    const [omschrijving, setOmschrijving] = useState('');
    const [ingediend, setIngediend] = useState(false);
    const gekozen = CATEGORIES.find((item) => item[0] === categorie) || CATEGORIES[0];

    function openMelding() {
        if (!open && tijdensRonde) spel.pauzeVoorMelding?.();
        setOpen((vorige) => !vorige);
    }

    function verstuur(e) {
        e.preventDefault();
        if (gekozen[2] && !correctie.trim()) return;
        const soort = ['geen_geluid', 'verkeerd_nummer'].includes(categorie) ? categorie : 'fout';
        const toelichting = '[' + categorie + '] ' +
            (correctie.trim() ? 'Correctie: ' + correctie.trim() + '. ' : '') +
            (omschrijving.trim() || '');
        spel.meldFout(soort, toelichting.slice(0, 500));
        setIngediend(true);
        setOpen(false);
    }

    return (
        <section className="vt-issue">
            <button className="knop knop-stil vt-issue-toggle" type="button" onClick={openMelding}
                aria-expanded={open}>
                {open ? 'Sluit foutmelding' : '⚑ Fout melden'}
            </button>
            {open && (
                <form className="vt-issue-form" onSubmit={verstuur}>
                    {tijdensRonde && <p className="dim">Het spel is gepauzeerd. De host kan het na de melding hervatten.</p>}
                    <label>Wat klopt er niet?
                        <select className="invoer" value={categorie} onChange={(e) => { setCategorie(e.target.value); setCorrectie(''); }}>
                            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    {gekozen[2] && <label>Wat moet het volgens jou zijn?
                        <input className="invoer" value={correctie} onChange={(e) => setCorrectie(e.target.value)}
                            required maxLength={200} placeholder="Juiste titel, jaar, hint, vraag of afbeelding/bron" />
                    </label>}
                    <label>Toelichting (optioneel)
                        <textarea className="invoer" rows={2} maxLength={250} value={omschrijving}
                            onChange={(e) => setOmschrijving(e.target.value)} placeholder="Extra informatie" />
                    </label>
                    <button className="knop" type="submit">Melding versturen</button>
                </form>
            )}
            {ingediend && !open && <span className="dim" role="status">Melding verstuurd, bedankt.</span>}
        </section>
    );
}
