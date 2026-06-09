import axios from 'axios';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
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
      window.location.href = '/login';
    }

    // Network errors or server unreachable
    if (!error.response) {
      error.userMessage = 'No se pudo conectar con el servidor. Verifica tu conexión.';
    } else if (status >= 500) {
      error.userMessage = 'Error interno del servidor. Inténtalo de nuevo en un momento.';
    } else if (status === 403) {
      error.userMessage = 'No tienes permisos para realizar esta acción.';
    } else if (status === 404) {
      error.userMessage = 'El recurso solicitado no fue encontrado.';
    }

    return Promise.reject(error);
  }
);

export default api;
