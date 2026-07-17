import { io } from 'socket.io-client';
import { auth } from './firebase';

const configuredApiUrl = import.meta.env.VITE_API_URL;
export const SOCKET_URL = (!configuredApiUrl || configuredApiUrl === 'http://localhost:4000/api')
  ? `http://${window.location.hostname}:4000`
  : configuredApiUrl.replace(/\/api\/?$/, '');

// One socket per browser tab, shared across the whole app (chat, notification
// bell, alerts, etc.) so a user gets live updates everywhere, not just while
// a particular screen happens to be mounted. Components should add/remove
// their own listeners on this socket rather than opening a new connection.
let socket = null;

export const getSocket = () => {
  if (!socket) {
    // Sends the Firebase JWT (or the dev-bypass email) on the handshake so
    // the server can authenticate the WebSocket connection — without this,
    // the server's Socket.IO auth middleware rejects the connection.
    const devEmail = localStorage.getItem('devUserEmail');
    socket = io(SOCKET_URL, {
      auth: async (cb) => {
        if (devEmail) {
          cb({ devEmail });
        } else {
          const user = auth.currentUser;
          const token = user ? await user.getIdToken().catch(() => null) : null;
          cb({ token });
        }
      },
    });
  }
  return socket;
};

// Force-close and recreate the socket (e.g. after login/logout so the new
// user's credentials are sent on the next handshake).
export const resetSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
