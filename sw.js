// Service worker: caches the app files and the latest data.json so the page reloads with no network.
// Bump VERSION when app files change so old copies are replaced.
const VERSION = 'v2';
const APP_CACHE = `ohp-app-${VERSION}`;
const DATA_CACHE = 'ohp-data'; // separate so app upgrades never discard a newer downloaded snapshot
const DATA_PATH = new URL('data/data.json', self.registration.scope).pathname;

const APP_FILES = [
  './',
  'index.html',
  'assets/styles.css',
  'assets/favicon.svg',
  'src/main.js',
  'src/config.js',
  'src/data.js',
  'src/validate.js',
  'src/forecast.js',
  'src/summary.js',
  'src/chat.js',
  'src/llm.js',
  'src/map.js',
  'src/charts.js',
  'vendor/chart.umd.js',
  'data/phu_boundaries.geojson',
  'data/cities.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const data = await caches.open(DATA_CACHE);
    if (!(await data.match(DATA_PATH))) await data.add('data/data.json');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('ohp-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function latestDate(response) {
  try { return (await response.clone().json()).meta.latest_data_date || ''; } catch (e) { return null; }
}

// Data: serve what is cached; refresh in the background, but only accept a valid snapshot that is newer or equal.
async function handleData(request, event) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(DATA_PATH);
  const refresh = (async () => {
    try {
      const res = await fetch(request, { cache: 'no-cache' });
      if (!res.ok) return null;
      const newDate = await latestDate(res);
      if (newDate === null) return null;
      const oldDate = cached ? await latestDate(cached) : '';
      if (!cached || oldDate === null || newDate >= oldDate) await cache.put(DATA_PATH, res.clone());
      return res;
    } catch (e) { return null; }
  })();
  if (cached) { event.waitUntil(refresh); return cached; }
  return (await refresh) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin requests (e.g. optional model download)
  if (url.pathname === DATA_PATH) { event.respondWith(handleData(req, event)); return; }
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) {
      // refresh quietly for next time
      event.waitUntil(fetch(req).then((r) => { if (r.ok) cache.put(req, r); }).catch(() => {}));
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
