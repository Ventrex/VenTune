// =====================================================================
// Socket.IO-client. Eén gedeelde verbinding voor de hele app.
// =====================================================================

import { io } from 'socket.io-client';

let socket = null;

/** Geef de gedeelde socket (maakt hem aan bij de eerste aanroep). */
export function haalSocket() {
    if (!socket) {
        // Same-origin: nginx proxyt /socket.io naar de server.
        socket = io('/', {
            transports: ['websocket', 'polling'],
            autoConnect: true,
        });
    }
    return socket;
}
