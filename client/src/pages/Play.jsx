import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpel } from '../lib/useSpel.js';
import { wisSessie } from '../lib/sessie.js';
import Speelbord from '../components/Speelbord.jsx';

// Spelerscherm (telefoon/tablet). Geen audio: de host of de tv speelt de
// muziek. Kahoot-stijl: vraag bovenin, gekleurde antwoorden eronder.
export default function Play() {
    const navigate = useNavigate();
    const spel = useSpel();
    const { sessie, fase, spelers, teams } = spel;

    useEffect(() => {
        if (!sessie) navigate('/');
    }, [sessie, navigate]);
    if (!sessie) return null;

    function verlaten() {
        wisSessie();
        navigate('/');
    }

    if (fase !== 'wachten') return <Speelbord spel={spel} onVerlaten={verlaten} />;

    const ik = spelers.find((s) => s.id === sessie.spelerId);
    return (
        <main className="kz kz-lobby">
            <header className="kz-kop">
                <span className="kz-teller">Lobby <b>{sessie.code}</b></span>
                <span className="kz-kop-midden" />
                <button type="button" className="kz-icoon" onClick={verlaten} aria-label="Lobby verlaten">×</button>
            </header>
            <section className="kz-vraag">
                <h1>{ik ? `Hoi ${ik.naam}!` : 'Je doet mee!'}</h1>
                <p className="kz-sub">Wacht tot de host start. Kijk naar het grote scherm.</p>
            </section>
            {teams.length > 0 && (
                <section className="kz-team-keuze">
                    <p className="kz-label">Jouw team</p>
                    <div className="kz-rij">
                        {teams.map((team) => (
                            <button key={team} type="button" className={'kz-pil' + (ik?.team_naam === team ? ' aan' : '')}
                                onClick={() => spel.wijzigTeam(team)}>{team}</button>
                        ))}
                    </div>
                </section>
            )}
            <section className="kz-spelers">
                {spelers.map((s) => (
                    <span key={s.id} className={'kz-speler' + (s.id === sessie.spelerId ? ' ik' : '') + (s.verbonden ? '' : ' weg')}>
                        {s.naam}{s.team_naam ? <small>{s.team_naam}</small> : null}
                    </span>
                ))}
            </section>
            {spel.fout && <p className="kz-balk-melding fout">{spel.fout}</p>}
        </main>
    );
}
