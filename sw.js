// Service Worker — network-first (no caching during active development)
const CACHE_NAME = 'worldcup-2026-v12';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Always fetch from network, no caching
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('api.anthropic.com')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
