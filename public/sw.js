// IATOS Service Worker: Web Push para cambios de vuelo + lectura offline ligera.
//
// Offline (por qué): sin red en el aeropuerto o en el extranjero la app quedaba en
// blanco. Ahora guardamos:
//  - el "app shell" (index.html + bundles con hash de /assets/) para que la app abra,
//  - los últimos viajes consultados (GET a /rest/v1/trips) para leerlos sin conexión.
// Estrategias: navegación y datos = red primero (siempre lo más fresco si hay red);
// /assets/ = caché primero (los nombres llevan hash, nunca quedan viejos).
// Al cerrar sesión la app pide borrar los datos guardados (mensaje iatos:clear-user-cache).
// THE PRIVATE EDITION (piloto offline): la app guarda en EDITION_CACHE las ediciones descargadas (JSON +
// imágenes con licencia) por usuario; el SW las conserva entre versiones y las borra al cerrar sesión.
const SHELL_CACHE = 'iatos-shell-v1';
const DATA_CACHE = 'iatos-data-v1';
const EDITION_CACHE = 'iatos-edition-v1';
const MAX_TRIP_ENTRIES = 8;
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon-32.png', '/icons/icon-192.png'];

// Archivos del arranque que index.html pide (JS de entrada, modulepreload, CSS y tipografías): se
// guardan al instalar para que la SEGUNDA visita abra sin red lenta de por medio. Antes solo se
// guardaba lo que pasaba por el SW después de instalarse, y la primera carga quedaba fuera.
const SHELL_ASSET = /(?:src|href)="(\/(?:assets|fonts)\/[^"?#]+\.(?:js|css|woff2))"/g;

async function precacheShell(c) {
  try {
    const html = await c.match('/');
    if (!html) return;
    const text = await html.clone().text();
    const urls = [...new Set([...text.matchAll(SHELL_ASSET)].map((m) => m[1]))];
    // force-cache: lo que el navegador ya bajó en esta visita se toma de su caché HTTP (sin volver a
    // descargarlo por la red móvil).
    await Promise.all(urls.map((u) => c.add(typeof Request === 'function' ? new Request(u, { cache: 'force-cache' }) : u).catch(() => {})));
  } catch {
    /* opcional: la app funciona igual */
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // Nunca fallar la instalación por un recurso opcional.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))).then(() => precacheShell(c)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('iatos-') && k !== SHELL_CACHE && k !== DATA_CACHE && k !== EDITION_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'iatos:clear-user-cache') {
    event.waitUntil(Promise.all([caches.delete(DATA_CACHE), caches.delete(EDITION_CACHE)]));
  }
});

function isTripsApi(url) {
  return url.pathname.endsWith('/rest/v1/trips');
}

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  // keys() conserva el orden de inserción: borramos los más viejos.
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(request, cacheName, cacheKey, max) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const c = await caches.open(cacheName);
      await c.delete(cacheKey, { ignoreVary: true });
      await c.put(cacheKey, res.clone());
      if (max) await trimCache(cacheName, max);
    }
    return res;
  } catch (err) {
    const hit = await caches.match(cacheKey, { cacheName, ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request, { cacheName: SHELL_CACHE });
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    const c = await caches.open(SHELL_CACHE);
    await c.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // Navegación de la SPA: red primero; sin red, el index.html guardado.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE, '/', 0));
    return;
  }
  // Bundles con hash generados por Vite y tipografías versionadas (/fonts/*-vNN.woff2).
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'))) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Datos de viajes (Supabase REST, solo lectura): últimos viajes vistos.
  if (isTripsApi(url)) {
    // La misma URL puede pedirse como objeto o como arreglo (header Accept): lo
    // incluimos en la llave para no devolver offline una forma distinta.
    const accept = (req.headers && req.headers.get && req.headers.get('accept')) || '';
    const key = req.url + (req.url.includes('?') ? '&' : '?') + '__accept=' + encodeURIComponent(accept);
    event.respondWith(networkFirst(req, DATA_CACHE, key, MAX_TRIP_ENTRIES));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'IATOS', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'IATOS';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate(url); return w.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
