import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite-configuratie voor VenTune.
// In dev proxyt Vite de API- en socket-verzoeken naar de server, zodat
// alles vanaf één origin lijkt te komen (net als achter de tunnel).
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:3000', changeOrigin: true },
            '/auth': { target: 'http://localhost:3000', changeOrigin: true },
            '/socket.io': {
                target: 'http://localhost:3000',
                ws: true,
                changeOrigin: true,
            },
        },
    },
});
