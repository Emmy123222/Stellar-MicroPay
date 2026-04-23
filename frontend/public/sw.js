/**
 * public/sw.js
 * Service worker — handles incoming push events from the Push API
 * and displays notifications via ServiceWorkerRegistration.showNotification().
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 */

self.addEventListener('push', (event) => {
  let data = { title: 'Stellar Pay', body: 'You have a new notification.' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Stellar Pay', body: event.data.text() };
    }
  }

  // showNotification() is the correct Push API method for displaying
  // notifications from a service worker — NOT new Notification().
  // Reference: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing open tab if one exists
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
