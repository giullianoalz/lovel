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

// Halfway through a family signup the Firebase account exists but the academy
// profile does not, so /auth/me legitimately answers 401. Signing them out on
// that 401 — the normal, correct reaction everywhere else — would strip the very
// token POST /auth/signup needs, and the signup could never complete.
let signupInFlight = false;
export const setSignupInFlight = (value) => { signupInFlight = value; };
export const isSignupInFlight = () => signupInFlight;

// getIdToken() talks to Firebase over the network whenever the cached token
// is stale, and axios's own `timeout` above never starts counting until the
// request actually leaves the browser — it does not cover this interceptor.
// A stalled token refresh (flaky wifi, a captive portal, a tab that was
// backgrounded long enough for the SDK's internal state to wedge) used to hang
// every request indefinitely: no error, no timeout, a submit button stuck on
// "Submitting…" forever. Racing it against a hard cap turns that into an
// ordinary failed request the app's existing error handling already covers.
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  promise.then(
    (v) => { clearTimeout(timer); resolve(v); },
    (e) => { clearTimeout(timer); reject(e); },
  );
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
          const token = await withTimeout(user.getIdToken(), 8000);
          config.headers.Authorization = `Bearer ${token}`;
        } catch (error) {
          // Proceeds without a token rather than hanging — the server answers
          // 401 almost immediately, which the response interceptor and the
          // caller's own catch block already know how to surface.
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

    if (status === 401 && !signupInFlight) {
      // Token expired or invalid — sign out and redirect to login
      try {
        localStorage.removeItem('devUserEmail');
        await signOut(auth);
      } catch {
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
