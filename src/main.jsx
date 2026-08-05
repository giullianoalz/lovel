import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// No service worker is registered here on purpose. vite-plugin-pwa injects
// registerSW.js into index.html, which registers /sw.js — the one worker that
// both caches the app and (via importScripts in vite.config.js) handles
// Firebase background pushes. Registering a second worker at '/' would
// replace it and take the install prompt down with it.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
