// ─────────────────────────────────────────────
//  KRHDev To Do List — Service Worker (sw.js)
//  Place this file in your ROOT directory
//  (same level as index.htm, not inside /assets)
// ─────────────────────────────────────────────

const CACHE_NAME = 'krhdev-todo-v1';

const PRECACHE = [
  '/',
  '/index.htm',
  '/help.htm',
  '/settings.htm',
  '/manifest.json',
  '/assets/css/style.css',
  '/assets/js/script.js',
  '/assets/js/pwa-install.js',
  '/assets/js/json-io.js',
  '/assets/images/todo-icon-192x192.png',
  '/assets/images/todo-icon-512x512.png'
];

// Install — cache all core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate — delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});