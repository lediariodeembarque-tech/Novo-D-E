const CACHE_NAME = 'diario-embarque-v19';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/html2pdf.bundle.min.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-192-maskable.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/logo.png',
  '/logo-192.png',
  '/apple-touch-icon.png',
  '/favicon.png',
  '/favicon.ico',
  '/src/assets/images/avatares/capita-azul.png',
  '/src/assets/images/avatares/comandante-branco.png',
  '/src/assets/images/avatares/amandinha.png',
  '/src/assets/images/avatares/trovao.png',
  '/src/assets/images/avatares/luzinha.png',
  '/src/assets/images/avatares/aventureiro.png',
  '/src/assets/images/avatares/cha-e-pista.png',
  '/src/assets/images/avatares/techy.png',
  '/src/assets/images/avatares/explorer.png',
  '/src/assets/images/avatares/navegador.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js'
];

self.addEventListener('message', (event) => {
  if (event.data && (event.data === 'SKIP_WAITING' || event.data.action === 'skipWaiting')) {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('Precaching skipped for:', asset, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, media files, APK downloads, and Range requests
  if (
    event.request.method !== 'GET' ||
    event.request.headers.get('range') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.mp4') ||
    url.pathname.endsWith('.webm') ||
    url.pathname.endsWith('.apk') ||
    url.pathname.includes('apk')
  ) {
    return;
  }

  // Allow caching of trusted CDN libraries (like Chart.js)
  const isCdnAsset = url.hostname === 'cdn.jsdelivr.net';
  if (!isCdnAsset && url.origin !== self.location.origin) {
    return;
  }

  // CDN assets use Cache-first strategy for instant load
  if (isCdnAsset) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // Network-first strategy with cache fallback for navigation and core app assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html').then((htmlRes) => {
              if (htmlRes) return htmlRes;
              return caches.match('/');
            });
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
