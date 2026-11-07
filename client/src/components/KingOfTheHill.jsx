import React from 'react';

// =====================================================================
// King of the Hill: goed = een stap omhoog, fout = een stap omlaag.
// Tegen elkaar: iedereen eigen plek op de berg, de koploper heeft 👑.
// Samen: één gezamenlijke klimmer.
// =====================================================================

function Treden({ stappen, positie, laatste }) {
    return (
        <div className="koth-treden" role="img" aria-label={`${positie} van ${stappen} stappen`}>
            {Array.from({ length: stappen }, (_, i) => (
                <span key={i} className={'koth-trede' + (i < positie ? ' vol' : '') + (i === positie - 1 && laatste > 0 ? ' net' : '')}
                    style={{ height: `${30 + (i / Math.max(1, stappen - 1)) * 70}%` }} />
            ))}
            <span className="koth-vlag" aria-hidden="true">🚩</span>
        </div>
    );
}

export default function KingOfTheHill({ koth, instellingen, scorebord, eind = false, mijnId }) {
    const modus = koth?.modus || (instellingen?.koth_modus === 'samen' ? 'samen' : 'tegen');
    const stappen = koth?.stappen || Number(instellingen?.koth_stappen) || 10;
    const winnaars = koth?.winnaars || [];

    if (modus === 'samen') {
        const pos = koth?.team || 0;
        const l = koth?.laatste?.team;
        return (
            <section className="koth" aria-live="polite">
                <strong>⛰️ King of the Hill · samen · {pos}/{stappen}</strong>
                <Treden stappen={stappen} positie={pos} laatste={l} />
                {winnaars.length > 0 ? <p className="koth-winst">🏆 Jullie staan bovenaan!</p>
                    : l ? <p className="dim">{l > 0 ? 'Goed! Een stap omhoog.' : 'Niemand had het goed: een stap omlaag.'}</p> : null}
            </section>
        );
    }

    // Tegen elkaar: posities van de server, aangevuld met spelers die nog op 0 staan.
    const bekend = new Map((koth?.spelers || []).map((s) => [String(s.id), s]));
    for (const s of scorebord || []) {
        if (!bekend.has(String(s.id))) bekend.set(String(s.id), { id: s.id, naam: s.naam, positie: 0 });
    }
    const lijst = [...bekend.values()].sort((a, b) => b.positie - a.positie || String(a.naam).localeCompare(String(b.naam)));
    const top = lijst.length ? lijst[0].positie : 0;
    return (
        <section className="koth" aria-live="polite">
            <strong>⛰️ King of the Hill · eerst op {stappen}</strong>
            <ul className="koth-lijst">
                {lijst.map((s) => {
                    const l = koth?.laatste?.[s.id];
                    const koning = s.positie > 0 && s.positie === top;
                    return (
                        <li key={s.id} className={(koning ? 'koning ' : '') + (String(s.id) === String(mijnId) ? 'ik' : '')}>
                            <span className="koth-naam">{koning ? '👑 ' : ''}{s.naam}</span>
                            <Treden stappen={stappen} positie={s.positie} laatste={l} />
                            <span className="koth-pos">{s.positie}{l ? (l > 0 ? ' ▲' : ' ▼') : ''}</span>
                        </li>
                    );
                })}
            </ul>
            {winnaars.length > 0 && (
                <p className="koth-winst">🏆 {lijst.filter((s) => winnaars.includes(String(s.id))).map((s) => s.naam).join(' & ')} {winnaars.length > 1 ? 'staan' : 'staat'} bovenaan!</p>
            )}
            {eind && !winnaars.length && <p className="dim">Niemand haalde de top; de hoogste klimmer wint.</p>}
        </section>
    );
}
