importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDcmp-F_BCTqn-eNWbwGys3saLwAri4VPU',
  authDomain: 'llexplorers2026.firebaseapp.com',
  projectId: 'llexplorers2026',
  storageBucket: 'llexplorers2026.firebasestorage.app',
  messagingSenderId: '453126630374',
  appId: '1:453126630374:web:0c337be81e9e0f5ea18427',
});

const messaging = firebase.messaging();

// Shows a system notification when a push arrives while the app is in the background/closed.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Love Learning Explorers', {
    body: body || '',
    icon: '/favicon.svg',
    data: payload.data,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(clients.openWindow(link));
});
