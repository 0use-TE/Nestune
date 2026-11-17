/** A new worker is generated for each production build. Never cache account data or audio. */
export function workerSource(version: string) {
  return `
const CACHE = 'nestune-pwa-' + ${JSON.stringify(version)};
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png'];
const MAX_ENTRIES = 100;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('nestune-pwa-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let requestId = '';
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.status < 500 || response.headers.has('x-nestune-error-code')) return response;
        const id = response.headers.get('x-request-id') || '';
        if (/^[a-zA-Z0-9_-]{8,64}$/.test(id)) requestId = id;
      } catch {} finally { clearTimeout(timer); }
      const fallback = await (await caches.open(CACHE)).match(OFFLINE);
      if (fallback) {
        const html = (await fallback.text()).replace('data-request-id="{http.request.uuid}"', 'data-request-id="' + requestId + '"');
        return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-ID': requestId } : {}) } });
      }
      return new Response('暂时无法连接，请检查网络后重试。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  // Only immutable build assets and public PWA assets are eligible for caching.
  if (!url.pathname.startsWith('/_next/static/') && !PRECACHE.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      try {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        const disposable = keys.filter(key => !PRECACHE.includes(new URL(key.url).pathname));
        await Promise.all(disposable.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map(key => cache.delete(key)));
      } catch {}
    }
    return response;
  })());
});
`;
}
