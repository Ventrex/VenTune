import React from 'react';
import { createRoot } from 'react-dom/client';
// Lokaal gebundeld Inter-font (woff2, geen Google Fonts CDN).
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import App from './App.jsx';
import './styles/theme.css';

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
