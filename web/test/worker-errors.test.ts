import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
import { workerSource } from '@/server/pwa-worker';

function worker(fetch: typeof globalThis.fetch) {
  const handlers: Record<string, (event: any) => void> = {};
  vm.runInNewContext(workerSource('test-build'), { self: { location: { origin: 'https://music.test' }, addEventListener: (type: string, handler: any) => { handlers[type] = handler; } }, URL, Response, AbortController, setTimeout, clearTimeout,
    fetch, caches: { open: async () => ({ match: async () => new Response('<body data-request-id="{http.request.uuid}">Offline</body>') }) } });
  return (path: string, mode = 'navigate') => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url: 'https://music.test' + path, mode, headers: new Headers() }, respondWith: (value: Promise<Response>) => { result = value; } });
    return result;
  };
}
it('keeps a diagnostic gateway page and its request ID intact', async () => {
  const failure = new Response('<html>Gateway diagnostic page</html>', { status: 502, headers: { 'X-Nestune-Error-Code': 'gateway_upstream_unreachable', 'X-Request-ID': 'abcd1234' } });
  const result = await worker(vi.fn(async () => failure))('/square');
  expect(result).toBe(failure); expect(result?.headers.get('X-Request-ID')).toBe('abcd1234');
});
it('uses a 503 cached fallback and preserves the ID of an unexpected application error', async () => {
  const result = await worker(vi.fn(async () => new Response('failed', { status: 500, headers: { 'X-Request-ID': 'abcd1234' } })))('/square');
  expect(result?.status).toBe(503); expect(await result?.text()).toContain('data-request-id="abcd1234"');
});
it('falls back safely after a network failure and leaves API requests outside the cache', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('offline'); });
  const request = worker(fetch);
  const result = await request('/square');
  expect(result?.status).toBe(503); expect(await result?.text()).toContain('data-request-id=""');
  expect(request('/api/health', 'cors')).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(1);
});
