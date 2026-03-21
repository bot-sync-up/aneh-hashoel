// Firebase Cloud Messaging Service Worker
// This file is required for FCM push notifications.
// It will be activated automatically when Firebase credentials are configured.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Firebase config is injected at runtime via __FIREBASE_CONFIG__ global
// (set in index.html or via environment variable)
const firebaseConfig = self.__FIREBASE_CONFIG__ || null;

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(function (payload) {
    const { title, body, icon } = payload.notification || {};
    self.registration.showNotification(title || 'ענה את השואל', {
      body: body || '',
      icon: icon || '/favicon.svg',
      badge: '/favicon.svg',
      dir: 'rtl',
      lang: 'he',
    });
  });
}
