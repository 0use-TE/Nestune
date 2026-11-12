import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { workerSource } from '@/server/pwa-worker';
import manifest from '@/app/manifest';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => new Response('offline')), put: vi.fn(async () => {}), keys: vi.fn(async () => []), delete: vi.fn(async () => true) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['other-app', 'nestune-pwa-old', 'nestune-pwa-test']), delete: vi.fn(async () => true) };
  const fetch = vi.fn(async () => new Response('online'));
  const self = { location: { origin: 'https://music.0use.net' }, clients: { claim: vi.fn(async () => {}) }, skipWaiting: vi.fn(), addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; } };
  runInNewContext(workerSource('test'), { self, caches, fetch, URL, Response });
  function request(path: string, options: { method?: string; mode?: string; range?: boolean } = {}) {
    const respondWith = vi.fn();
    handlers.fetch({ request: { url: new URL(path, self.location.origin).href, method: options.method ?? 'GET', mode: options.mode ?? 'cors', headers: new Headers(options.range ? { range: 'bytes=0-10' } : {}) }, respondWith });
    return respondWith;
  }
  return { handlers, cache, caches, fetch, self, request };
}

describe('PWA cache boundaries', () => {
  it('does not intercept account APIs, audio, admin, external requests or writes', () => {
    const w = worker();
    for (const path of ['/api/me', '/api/auth/login', '/api/songs/1/stream', '/api/uploads', '/admin', '/admin/users', 'https://other.example/_next/static/a.js']) {
      expect(w.request(path)).not.toHaveBeenCalled();
    }
    expect(w.request('/_next/static/a.js', { method: 'POST' })).not.toHaveBeenCalled();
    expect(w.request('/_next/static/a.js', { range: true })).not.toHaveBeenCalled();
  });

  it('uses the network for navigation without storing personalized HTML', async () => {
    const w = worker();
    const result = w.request('/settings', { mode: 'navigate' });
    expect(await (await result.mock.calls[0][0]).text()).toBe('online');
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.cache.match).not.toHaveBeenCalled();
  });

  it('shows the offline fallback when navigation fails or the server is unavailable', async () => {
    const w = worker();
    for (const fail of [() => Promise.reject(new Error('offline')), async () => new Response('down', { status: 503 })]) {
      w.fetch.mockImplementationOnce(fail);
      const result = w.request('/library', { mode: 'navigate' });
      expect(await (await result.mock.calls[0][0]).text()).toBe('offline');
    }
    expect(w.cache.match).toHaveBeenCalledWith('/offline.html');
  });

  it('only removes its own previous caches and waits for explicit activation', async () => {
    const w = worker();
    let task: Promise<void> | undefined;
    w.handlers.install({ waitUntil: (p: Promise<void>) => { task = p; } });
    await task;
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    w.handlers.activate({ waitUntil: (p: Promise<void>) => { task = p; } });
    await task;
    expect(w.caches.delete.mock.calls).toEqual([['nestune-pwa-old']]);
    w.handlers.message({ data: { type: 'ACTIVATE_UPDATE' } });
    expect(w.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('uses a distinct worker and cache name for a new release', () => {
    expect(workerSource('release-a')).not.toBe(workerSource('release-b'));
  });
});

describe('PWA manifest', () => {
  it('keeps the installed identity stable and provides regular and maskable icons', () => {
    const m = manifest();
    expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    expect(m.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
  });
});
