const CACHE_PREFIX = 'btc-forensics-';
const APP_CACHE = `${CACHE_PREFIX}app-v3`;
const API_CACHE = `${CACHE_PREFIX}api-v2`;
const CORE_ASSETS = ['/manifest.json', '/favicon.svg', '/icons.svg'];
const API_CACHE_DURATION = 5 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== APP_CACHE && name !== API_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') {
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(fetch(request).catch(() => offlineApiResponse()));
    }
    return;
  }
  if (url.pathname === '/health') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => offlineApiResponse()));
    return;
  }
  // These routes expose the in-memory upload session and change immediately
  // after analyze/clear requests. Serving a cached response can resurrect a
  // previous import or hide a newly uploaded one.
  if (url.pathname.startsWith('/api/ingestion/')
    || url.pathname.startsWith('/api/investigate/')
    || url.pathname.startsWith('/api/graph/')) {
    event.respondWith(fetch(request).catch(() => offlineApiResponse()));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheApplicationShell() {
  const cache = await caches.open(APP_CACHE);
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok) throw new Error('The local dashboard could not be cached.');

  await cache.put('/', response.clone());
  await cache.put('/index.html', response.clone());
  const assetManifestResponse = await fetch('/offline-assets.json', { cache: 'reload' });
  if (!assetManifestResponse.ok) throw new Error('The offline asset list could not be loaded.');
  const builtAssets = await assetManifestResponse.json();
  if (!Array.isArray(builtAssets) || builtAssets.some((path) => typeof path !== 'string')) {
    throw new Error('The offline asset list is invalid.');
  }

  await cache.addAll([...new Set([...CORE_ASSETS, '/offline-assets.json', ...builtAssets])]);
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put('/', response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', Date.now().toString());
      await cache.put(request, new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }));
    }
    return response;
  });

  if (cached) {
    const cachedAt = Number(cached.headers.get('sw-cached-at') || 0);
    if (Date.now() - cachedAt <= API_CACHE_DURATION) {
      refresh.catch(() => undefined);
      return cached;
    }
  }

  try {
    return await refresh;
  } catch {
    return cached || offlineApiResponse();
  }
}

function offlineApiResponse() {
  return new Response(JSON.stringify({ detail: 'The local analysis service is unavailable. Start the local dashboard service and try again.' }), {
    status: 503,
    statusText: 'Local service unavailable',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
