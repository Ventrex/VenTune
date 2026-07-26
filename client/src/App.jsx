import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Setup from './pages/Setup.jsx';
import Join from './pages/Join.jsx';
import Host from './pages/Host.jsx';
import Play from './pages/Play.jsx';
import Admin from './pages/Admin.jsx';
import MuziekTest from './pages/MuziekTest.jsx';
import Changelog from './pages/Changelog.jsx';
import HostAuth from './pages/HostAuth.jsx';
import { haalAppInstellingen } from './lib/api.js';
import { ThemaContext } from './lib/thema.js';

// Routing voor VenTune.
export default function App() {
    const [thema, setThema] = useState({});

    useEffect(() => {
        haalAppInstellingen().then((nieuw) => {
            setThema(nieuw || {});
            const root = document.documentElement;
            const mapping = {
                achtergrond: '--bg', oppervlak: '--surface', rand: '--border',
                accent: '--red-hot', accentDonker: '--red', tekst: '--text',
                tekstDim: '--text-dim', lettertype: '--app-font',
            };
            Object.entries(mapping).forEach(([bron, css]) => {
                if (nieuw?.[bron]) root.style.setProperty(css, nieuw[bron]);
            });
            if (nieuw?.fontSchaal) root.style.setProperty('--font-scale', String(nieuw.fontSchaal));
            if (nieuw?.appNaam) document.title = nieuw.appNaam;
        }).catch(() => {});
    }, []);

    return (
        <ThemaContext.Provider value={thema}>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/setup" element={<Setup />} />
                    <Route path="/host/login" element={<HostAuth />} />
                    <Route path="/join/:code" element={<Join />} />
                    <Route path="/host" element={<Host />} />
                    <Route path="/play" element={<Play />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/muziek" element={<MuziekTest />} />
                    <Route path="/changelog" element={<Changelog />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </ThemaContext.Provider>
    );
}
