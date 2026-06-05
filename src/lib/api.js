import axios from 'axios';
import { auth } from './firebase';

const api = axios.create({
  baseURL: 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to automatically attach authorization headers
api.interceptors.request.use(
  async (config) => {
    // Check if developer bypass email is in localStorage
    const devEmail = localStorage.getItem('devUserEmail');
    if (devEmail) {
      config.headers['x-dev-user-email'] = devEmail;
    } else {
      // Otherwise, grab Firebase User and attach bearer token
      const user = auth.currentUser;
      if (user) {
        try {
          const token = await user.getIdToken();
          config.headers.Authorization = `Bearer ${token}`;
        } catch (error) {
          console.error('[API Interceptor] Error getting Firebase ID Token:', error);
        }
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
