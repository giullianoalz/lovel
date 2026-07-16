import { io } from 'socket.io-client';

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
    socket = io(SOCKET_URL);
  }
  return socket;
};
