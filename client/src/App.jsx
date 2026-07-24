import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Setup from './pages/Setup.jsx';
import Join from './pages/Join.jsx';
import Lobby from './pages/Lobby.jsx';
import MuziekTest from './pages/MuziekTest.jsx';

// Routing voor VenTune. Host- en spelschermen (Play, Score) volgen in de
// volgende stappen.
export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/join/:code" element={<Join />} />
                <Route path="/lobby" element={<Lobby />} />
                <Route path="/muziek" element={<MuziekTest />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
