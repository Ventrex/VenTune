import React from 'react';
import { createRoot } from 'react-dom/client';
// Lokaal gebundelde fonts (woff2, geen Google Fonts CDN).
// Inter = body overal. Orbitron = Neon Arcade. Fraunces = Kerst Cozy.
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/700.css';
import App from './App.jsx';
import { pasToegepastThemaToe } from './lib/looks.js';
import './styles/theme.css';

// Zet het gekozen thema vóór render, zodat er geen flits is.
pasToegepastThemaToe();

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

// Service worker registreren (PWA). Faalt stil in omgevingen zonder SW.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
