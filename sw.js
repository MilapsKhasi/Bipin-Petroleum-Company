const CACHE_NAME = 'bipin-petroleum-app-shell-v3';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/index.tsx',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Geologica:wght@300;400;500;600;700&family=Georama:ital,wght@0,300..700;1,300..700&display=swap'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching app shell assets...');
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && (res.status === 200 || res.type === 'opaque')) {
              await cache.put(req, res);
            }
          } catch (e) {
            try {
              const req = new Request(url, { mode: 'no-cors' });
              const res = await fetch(req);
              if (res) {
                await cache.put(req, res);
              }
            } catch (err) {
              console.warn('[SW] Pre-cache failed for:', url, err);
            }
          }
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // Skip Supabase database & auth endpoints so JS layer handles offline mode via IndexedDB
  if (
    url.hostname.includes('supabase') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/')
  ) {
    return;
  }

  // Network-First for HTML/JS/TS/CSS in dev/online, fallback to Cache
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      } catch (err) {
        const cachedResponse = await caches.match(request) || await caches.match('/index.html') || await caches.match('/');
        if (cachedResponse) {
          return cachedResponse;
        }
        return new Response('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
          headers: { 'Content-Type': 'text/html' }
        });
      }
    })()
  );
});
