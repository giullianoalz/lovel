import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Register a service worker unconditionally so the browser can offer
// "Add to Home Screen" / install-as-app without waiting on the user to
// first grant push notification permission (fcm.js re-registers the same
// URL when that happens — browsers dedupe repeat registrations).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
