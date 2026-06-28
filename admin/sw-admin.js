// MP-ADMIN-PWA-V1 — service worker for the Partenaire Admin portal.
//
// admin.html is a standalone static HTML app (not part of the Vite
// React bundle), so it gets its own SW separate from MP's sw.js.
// Scoped to /admin.html so it doesn't interfere with the MP service
// worker also living at the same origin.
//
// Cache strategy (per the spec):
//   /api/*               NetworkFirst — admin actions need fresh data;
//                        cache only as fallback for an offline GET.
//   shell HTML + icon    CacheFirst   — admin.html + /icon.svg cached
//                        on install so the app shell launches offline.
//   chart.js CDN         CacheFirst   — heavy cross-origin dependency
//                        only fetched once per version.
//   everything else      Pass-through.
//
// Skip waiting + claim clients on update so the admin always gets the
// latest version without a hard refresh (admin actions are sensitive
// and stale code = stale validation rules).
//
// v1.1 (separate work item) will add the push event handler that
// fires on pa_admin_notifications-driven push events.

const VERSION = 'admin-pwa-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const API_CACHE = `${VERSION}-api`;

// MP-ADMIN-OWN-DOMAIN: served at the ROOT of partenairedozieadmin.com, so the
// shell is '/' (not '/admin.html' as on the shared host).
const SHELL_URLS = [
  '/',
  '/icon.svg',
  '/admin-manifest.json',
];

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — wipe old caches, claim clients ───────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== API_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── FETCH ───────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutations always go to network

  const url = new URL(req.url);

  // Same-origin /api/* → NetworkFirst with API_CACHE fallback.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Shell asset hits — admin.html / icon / manifest. CacheFirst with
  // background-revalidate so a fresh deploy lands on next nav.
  if (url.origin === self.location.origin && SHELL_URLS.some(s => url.pathname === s)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // chart.js CDN dependency — CacheFirst (versioned URL, immutable).
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('chart.js')) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Navigation requests for admin (back/forward, refresh) → serve the
  // cached shell when offline so the admin sees the app skeleton +
  // a clear "online required" message inside the page logic rather
  // than the browser's chrome-level "no internet" page.
  // MP-ADMIN-OWN-DOMAIN: any same-origin navigation falls back to the root
  // shell ('/') when offline (the whole domain IS the admin app).
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).catch(() => caches.match('/'))
    );
    return;
  }

  // Everything else: pass-through.
});

// ── STRATEGIES ──────────────────────────────────────────────────

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    // Only cache 2xx responses — caching a 5xx would poison the
    // fallback and mask a transient outage as a permanent error.
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Last-resort offline response for /api fetches with no cache.
    return new Response(JSON.stringify({
      success: false,
      offline: true,
      message: 'Offline — admin actions require an internet connection.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) {
    // Background revalidate so the next nav picks up new shell HTML.
    fetch(req).then(fresh => {
      if (fresh.ok) caches.open(cacheName).then(c => c.put(req, fresh));
    }).catch(() => { /* offline; cached still serves */ });
    return cached;
  }
  const fresh = await fetch(req);
  if (fresh.ok) {
    const cache = await caches.open(cacheName);
    cache.put(req, fresh.clone());
  }
  return fresh;
}

// ── MESSAGE — allows admin.html to ping for an immediate update ─
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
