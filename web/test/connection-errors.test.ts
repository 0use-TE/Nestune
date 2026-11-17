import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { fail, json, route } from '@/server/http';

const id = 'b38b84fe-5e01-459d-a153-8ef9d5dd1b8a';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('exposes a gateway error code and the same request ID to the caller without retrying a write', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: '入口无法连接音乐服务', code: 'gateway_upstream_unreachable', requestId: id }), { status: 502, headers: { 'X-Request-ID': id } }));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/api/canvas', { method: 'POST', json: { action: 'take' } })).rejects.toMatchObject({ name: 'ApiError', status: 502, code: 'gateway_upstream_unreachable', requestId: id });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('handles an HTML gateway failure and rejects corrupt successful responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'X-Request-ID': id } })));
  await expect(api('/api/me')).rejects.toMatchObject({ status: 502, code: 'http_502', requestId: id });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>unexpected proxy page</html>')));
  await expect(api('/api/me')).rejects.toMatchObject({ status: 200, code: 'invalid_response' });
});
it('distinguishes offline and unreachable states, while preserving explicit cancellation', async () => {
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  await expect(api('/api/me')).rejects.toMatchObject({ code: 'client_offline', status: 0 });
  vi.stubGlobal('navigator', { onLine: true });
  await expect(api('/api/me')).rejects.toMatchObject({ code: 'network_unreachable' });
  const abort = new DOMException('cancelled', 'AbortError');
  vi.stubGlobal('fetch', vi.fn(async () => { throw abort; }));
  await expect(api('/api/me')).rejects.toBe(abort);
});
it('keeps existing authentication events for expired sessions', async () => {
  const dispatch = vi.fn(); vi.stubGlobal('window', { dispatchEvent: dispatch });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'unauthorized', error: '请登录' }), { status: 401 })));
  await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError);
  expect(dispatch.mock.calls[0][0].type).toBe('nt:unauthorized');
});
it('returns and logs a correlated internal error without exposing the exception or query values', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const handler = route(() => { throw new Error('private database or account detail'); });
  const response = await handler(new NextRequest('http://localhost/api/example?token=private-query', { headers: { 'X-Request-ID': id } }), { params: Promise.resolve({}) });
  expect(response.status).toBe(500); expect(response.headers.get('X-Request-ID')).toBe(id);
  expect(await response.json()).toEqual({ error: '服务内部错误', code: 'internal_error', requestId: id });
  const record = JSON.parse(log.mock.calls[0][0]);
  expect(record).toMatchObject({ event: 'api_error', requestId: id, code: 'internal_error', path: '/api/example' });
  expect(JSON.stringify(record)).not.toContain('private-query'); expect(JSON.stringify(record)).not.toContain('private database');
});
it('keeps response streams, cookies and status when adding an ID; rejects unsafe IDs', async () => {
  const response = json({ ok: true });
  response.headers.append('Set-Cookie', 'first=one; HttpOnly'); response.headers.append('Set-Cookie', 'second=two; HttpOnly');
  const result = await route(() => response)(new NextRequest('http://localhost/api/auth', { headers: { 'X-Request-ID': 'bad id' } }), { params: Promise.resolve({}) });
  expect(result.headers.get('X-Request-ID')).toMatch(/^[a-f0-9-]{36}$/);
  expect(result.headers.getSetCookie()).toEqual(['first=one; HttpOnly', 'second=two; HttpOnly']);
  expect(await result.json()).toEqual({ ok: true });
});
it('identifies expected 503 errors while preserving origin protection', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const handler = route(() => { throw fail(503, '无法读取数据', 'database_unavailable'); });
  const result = await handler(new NextRequest('http://localhost/api/health'), { params: Promise.resolve({}) });
  expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ code: 'database_unavailable', requestId: expect.any(String) });
  const blocked = await handler(new NextRequest('http://localhost/api/health', { method: 'POST', headers: { Origin: 'https://unrelated.invalid', Host: 'localhost' } }), { params: Promise.resolve({}) });
  expect(blocked.status).toBe(403);
});
