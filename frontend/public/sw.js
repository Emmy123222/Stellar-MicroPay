const CACHE_VERSION = "v2";
const PRECACHE = `stellar-micropay-precache-${CACHE_VERSION}`;
const RUNTIME = `stellar-micropay-runtime-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  "/",
  "/dashboard",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

const RUNTIME_CACHE_HOSTS = new Set([
  self.location.hostname,
  "localhost",
  "127.0.0.1",
  "horizon-testnet.stellar.org",
  "horizon.stellar.org",
  "api.coingecko.com",
]);

function isCacheableResponse(response) {
  return response && response.ok && ["basic", "cors"].includes(response.type);
}

function isRuntimeCacheableRequest(request, url) {
  if (request.method !== "GET") return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  return RUNTIME_CACHE_HOSTS.has(url.hostname);
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function handleNavigation(request) {
  const cache = await caches.open(RUNTIME);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request)) ||
      (await caches.match("/")) ||
      Response.error()
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("stellar-micropay-") &&
                ![PRECACHE, RUNTIME].includes(key)
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isRuntimeCacheableRequest(request, url)) {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener("push", (event) => {
  // Push API handler (Closes #1143): parse the push payload and call
  // self.registration.showNotification so users are notified even when
  // the tab is backgrounded.
  let data = { title: "Stellar Pay", body: "You have a new notification." };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Stellar Pay", body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/favicon.svg",
      data: { url: data.url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  // Notification click opens the dashboard (#1143).
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/dashboard") && "focus" in client) return client.focus();
      }
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
