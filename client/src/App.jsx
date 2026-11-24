import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Setup from './pages/Setup.jsx';
import Join from './pages/Join.jsx';
import Host from './pages/Host.jsx';
import Tv from './pages/Tv.jsx';
import Play from './pages/Play.jsx';
import Review from './pages/Review.jsx';
import Changelog from './pages/Changelog.jsx';
import Aanvragen from './pages/Aanvragen.jsx';
import Scores from './pages/Scores.jsx';
import HostAuth from './pages/HostAuth.jsx';
import HostProfile from './pages/HostProfile.jsx';
import { haalAppInstellingen } from './lib/api.js';
import { ThemaContext } from './lib/thema.js';

// Oude beheerlinks (/admin/bank?tab=…) gaan naar het beheer op de startpagina.
function NaarBeheer({ tab = 'overzicht' }) {
    const { search } = useLocation();
    const q = new URLSearchParams(search);
    if (!q.has('tab')) q.set('tab', tab);
    return <Navigate to={`/?${q}`} replace />;
}

// Routing voor VenTune.
export default function App() {
    const [thema, setThema] = useState({});

    useEffect(() => {
        haalAppInstellingen().then((nieuw) => {
            // Alleen naam/logo/ondertitel en lettergrootte uit de
            // serverinstellingen gebruiken. De KLEUREN komen uit het gekozen
            // thema (Neon / Noir / Kerst via data-thema); die mogen hier niet
            // meer overschreven worden, anders wint altijd de oude roodinstelling.
            setThema(nieuw || {});
            const root = document.documentElement;
            if (nieuw?.fontSchaal) root.style.setProperty('--font-scale', String(nieuw.fontSchaal));
            if (nieuw?.appNaam) document.title = nieuw.appNaam;
        }).catch(() => {});
    }, []);

    return (
        <ThemaContext.Provider value={thema}>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/setup" element={<Home />} />
                    <Route path="/setup/new" element={<Setup />} />
                    <Route path="/host/login" element={<HostAuth />} />
                    <Route path="/host/profile" element={<HostProfile />} />
                    <Route path="/join/:code" element={<Join />} />
                    <Route path="/host" element={<Host />} />
                    <Route path="/tv/:code" element={<Tv />} />
                    <Route path="/play" element={<Play />} />
                    <Route path="/admin" element={<NaarBeheer tab="systeem" />} />
                    <Route path="/admin/bank" element={<NaarBeheer />} />
                    <Route path="/admin/ai" element={<NaarBeheer tab="ai" />} />
                    <Route path="/admin/swipe" element={<NaarBeheer tab="swipen" />} />
                    <Route path="/review" element={<Review />} />
                    <Route path="/changelog" element={<Changelog />} />
                    <Route path="/aanvragen" element={<Aanvragen />} />
                    <Route path="/scores" element={<Scores />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </ThemaContext.Provider>
    );
}
