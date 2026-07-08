import axios from 'axios';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';

// Falls back to the current page's hostname (not hardcoded 'localhost') so the
// same dev build works whether opened as localhost or from a phone via LAN IP.
const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalDevDefault = !configuredApiUrl || configuredApiUrl === 'http://localhost:4000/api';
const api = axios.create({
  baseURL: isLocalDevDefault ? `http://${window.location.hostname}:4000/api` : configuredApiUrl,
  headers: { 'Content-Type': 'application/json' },
  // 60s so the first request survives a Render free-tier cold start (the server
  // can take 30-50s to wake from sleep); warm requests still return in <1s.
  timeout: 60000,
});

// Request interceptor — attach Firebase JWT or dev bypass header
api.interceptors.request.use(
  async (config) => {
    const devEmail = localStorage.getItem('devUserEmail');
    if (devEmail) {
      config.headers['x-dev-user-email'] = devEmail;
    } else {
      const user = auth.currentUser;
      if (user) {
        try {
          const token = await user.getIdToken();
          config.headers.Authorization = `Bearer ${token}`;
        } catch (error) {
          console.error('[API] Error getting Firebase ID Token:', error);
        }
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — centralised error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;

    if (status === 401) {
      // Token expired or invalid — sign out and redirect to login
      try {
        localStorage.removeItem('devUserEmail');
        await signOut(auth);
      } catch (_) {
        // ignore sign-out errors
      }
      
      // TEMPORARILY DISABLED: prevents the page from reloading so we can read the error in the console
      // window.location.href = '/login';
    }

    // Network errors or server unreachable
    if (!error.response) {
      error.userMessage = 'Could not connect to the server. Check your connection.';
    } else if (status >= 500) {
      error.userMessage = 'Internal server error. Please try again in a moment.';
    } else if (status === 403) {
      error.userMessage = 'You do not have permission to perform this action.';
    } else if (status === 404) {
      error.userMessage = 'The requested resource was not found.';
    } else if (status === 429) {
      error.userMessage = 'Too many requests — please wait a moment and try again.';
    }

    return Promise.reject(error);
  }
);

export default api;
