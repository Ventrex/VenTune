import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authSessie } from '../lib/api.js';

// Eén bovenbalk voor alle spelerspagina's: Home, Scores, Toevoegen,
// Controleren, Beheer en Profielen.
export default function TopNav({ actief = 'home', teksten = {} }) {
    const [account, setAccount] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const kop = (sleutel, standaard) => teksten[sleutel] || standaard;
    useEffect(() => {
        authSessie().then((d) => setAccount(d.ingelogd ? d.gebruiker : null)).catch(() => setAccount(null));
        fetch('/api/admin/sessie', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { ingelogd: false }))
            .then((d) => setIsAdmin(d.ingelogd === true)).catch(() => setIsAdmin(false));
    }, []);
    const link = (id, naar, icoon, label) => (
        <Link className={actief === id ? 'vt-top-active' : undefined} to={naar}><img src={`/category/${icoon}.svg`} alt="" />{label}</Link>
    );
    return (
        <nav className="vt-category-topnav vt-home-topnav" aria-label="VenTune navigatie">
            <Link className="vt-top-brand" to="/"><img className="vt-top-equalizer" src="/category/equalizer.svg" alt="" /><strong><span>Ven</span>Tune</strong></Link>
            <div className="vt-top-links">
                {link('home', '/', 'icon-home', kop('nav.home', 'Home'))}
                {link('scores', '/scores', 'icon-trophy', kop('nav.scores', 'Scores'))}
                {link('toevoegen', '/aanvragen', 'icon-add-music', kop('nav.aanvragen', 'Toevoegen'))}
                {(isAdmin || account?.rol === 'beoordelaar') && link('controleren', isAdmin ? '/admin/bank?tab=swipen' : '/review', 'icon-check', kop('nav.controleren', 'Controleren'))}
                {isAdmin && link('beheer', '/admin/bank', 'icon-settings', kop('nav.beheer', 'Beheer'))}
                {(isAdmin || (account && account.rol !== 'beoordelaar')) && link('profielen', account ? '/host/profile' : '/host/login?return=/host/profile', 'icon-users', kop('nav.profielen', 'Profielen'))}
            </div>
            <Link className="vt-top-user" to={account ? '/host/profile' : isAdmin ? '/admin/bank' : '/host/login?return=/host/profile'}>
                <span className="vt-avatar-ring">{account?.avatar_url
                    ? <img src={account.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : account?.display_naam?.slice(0, 1).toUpperCase() || '♫'}</span>
                {account?.display_naam || (isAdmin ? 'Beheerder' : kop('nav.inloggen', 'Inloggen'))}
            </Link>
        </nav>
    );
}
