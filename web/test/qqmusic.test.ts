import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
let qq: typeof import('@/server/qqmusic');
const raw = { mid: 'track123', type: 1, name: 'Song', interval: 240, singer: [{ mid: 'artist123', name: 'Artist' }], album: { mid: 'album123', name: 'Album' }, file: { media_mid: 'media456', size_128mp3: 4_000_000, size_320mp3: 10_000_000, size_flac: 30_000_000 }, pay: { pay_play: 1 } };
const globals = globalThis as typeof globalThis & { __qq_meta?: Map<string, unknown> };
let folder: string;
beforeAll(async () => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-qq-')); vi.stubEnv('DATA_DIR', folder); vi.stubEnv('QQMUSIC_URL', 'http://qq.test:8080'); qq = await import('@/server/qqmusic'); });
beforeEach(() => { globals.__qq_meta?.clear(); fs.writeFileSync(path.join(folder, 'qq-session.json'), JSON.stringify({ musicid: 123, musickey: 'test-only-not-a-real-credential', expired_at: Math.floor(Date.now() / 1000) + 3600 })); });
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('shapes public metadata without leaking media IDs or interpreting VIP flags as denial', () => {
  const song = qq.qqSong(raw); expect(song).toMatchObject({ id: 'qq-track123', provider: 'qq', access: { playable: true }, album: { id: 'qq-album123' } });
  expect(JSON.stringify(song)).not.toContain('media456'); expect(song.qualities?.map(q => q.level)).toEqual(['standard', 'exhigh', 'lossless']);
  expect(qq.qqCover('../bad')).toBe(null); expect(qq.qqCover('album123')).toContain('y.gtimg.cn/music/photo_new/');
});
it('requests QQ word timing and keeps normal LRC responses usable', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { lyric: '[1000,2000]你(1000,800)好(1800,1200)', trans: '[00:01.00]hello' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { lyric: '[00:01.00]普通歌词' } })));
  vi.stubGlobal('fetch', fetcher);
  const timed = await qq.qqLyrics('qq-track123');
  expect(timed.lines[0]).toMatchObject({ text: '你好', tr: 'hello', words: [{ t: 1, d: .8, text: '你' }, { t: 1.8, d: 1.2, text: '好' }] });
  expect((fetcher.mock.calls[0][0] as URL).searchParams.get('qrc')).toBe('true');
  expect((await qq.qqLyrics('qq-track123')).lines[0]).toMatchObject({ t: 1, text: '普通歌词' });
});
it('uses the distinct media MID and the documented format number with the bound account', async () => {
  const fetcher = vi.fn(async (url: URL | string) => new Response(JSON.stringify({ code: 0, data: String(url).includes('/detail') ? { track: raw } : { data: [{ result: 0, ekey: '', purl: 'M800media456.mp3?vkey=test-only' }] } })));
  vi.stubGlobal('fetch', fetcher);
  await expect(qq.qqMediaUrl('qq-track123', 'exhigh')).resolves.toMatchObject({ type: 'mp3', level: 'exhigh' });
  const [url, options] = fetcher.mock.calls[1] as unknown as [URL, RequestInit];
  expect(url.searchParams.get('media_mid')).toBe('media456'); expect(url.searchParams.get('file_type')).toBe('12'); expect(url.searchParams.get('song_type')).toBe('1');
  expect((options.headers as Record<string, string>).Cookie).toContain('musickey=test-only');
});
it('rejects denied, encrypted, preview and foreign-CDN responses', () => {
  for (const item of [{ result: 104003, purl: '' }, { result: 0, purl: 'M500media456.mp3', ekey: 'encrypted' }, { result: 0, purl: 'RS02media456.mp3' }, { result: 0, purl: 'https://evil.test/M500media456.mp3' }]) expect(() => qq.qqMediaData({ data: [item] }, 'standard')).toThrow();
  for (const url of ['http://127.0.0.1/a', 'https://qqmusic.qq.com.evil.test/a', 'https://evil@qqmusic.qq.com/a', 'file:///a', 'https://isure.stream.qqmusic.qq.com:9999/a']) expect(() => qq.assertQqMediaUrl(url)).toThrow();
  expect(() => qq.cookieHeader({ musickey: 'bad\r\nInjected: yes' })).toThrow();
});
it('verifies the upstream account rather than trusting a future local expiry timestamp', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: -1 }), { status: 401 })));
  await expect(qq.qqStatus()).resolves.toMatchObject({ loggedIn: false, expired: true });
});
it('does not expose upstream errors or credentials in a failed media request', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: -1, msg: 'musickey=secret-should-not-escape' }), { status: 500 })));
  await expect(qq.qqMediaUrl('qq-track123', 'standard')).rejects.toMatchObject({ status: 502, message: 'QQ 音乐请求失败，请稍后重试' });
});
it('reads a complete QQ playlist over multiple pages using the deployed API metadata shape', async () => {
  const fetcher = vi.fn(async (url: URL) => {
    const page = Number(url.searchParams.get('page'));
    const count = page === 1 ? 100 : 11;
    return new Response(JSON.stringify({ code: 0, data: { info: { title: 'Public playlist', picurl: 'https://y.gtimg.cn/cover.jpg' }, total: 111, songs: Array.from({ length: count }, (_, i) => ({ ...raw, mid: 'track' + ((page - 1) * 100 + i) })) } }));
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await qq.qqPlaylist('123');
  expect(result).toMatchObject({ name: 'Public playlist', cover: 'https://y.gtimg.cn/cover.jpg' });
  expect(result.songs).toHaveLength(111);
  expect(result.songs[100].id).toBe('qq-track100');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

const sessionFile = () => path.join(folder, 'qq-session.json');
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const mediaResponse = () => response({ data: [{ result: 0, ekey: '', purl: 'M500media456.mp3?vkey=test-only' }] });
it.each(['snake', 'camel'])('renews an expired playback key despite a future long-lived expiry and retains %s timing', async style => {
  const now = Math.floor(Date.now() / 1000);
  const old = { musicid: 123, musickey: 'old-key', refresh_token: 'refresh-only', expired_at: now + 60 * 86400,
    musickey_create_time: now - 3 * 86400 - 30, key_expires_in: 3 * 86400 };
  fs.writeFileSync(sessionFile(), JSON.stringify(old));
  const fresh = { musicid: 123, musickey: 'new-key', refresh_token: 'new-refresh-only', expired_at: now + 60 * 86400,
    ...(style === 'snake' ? { musickey_create_time: now, key_expires_in: 3 * 86400 } : { musickeyCreateTime: now, keyExpiresIn: 3 * 86400 }) };
  const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
    if (url.pathname.endsWith('/detail')) return response({ track: raw });
    if (url.pathname.endsWith('/refresh_credential')) return response(fresh);
    expect((options.headers as Record<string, string>).Cookie).toContain('musickey=new-key');
    return mediaResponse();
  });
  vi.stubGlobal('fetch', fetcher);
  await qq.qqMediaUrl('qq-track123', 'standard');
  await qq.qqMediaUrl('qq-track123', 'standard');
  expect(fetcher.mock.calls.filter(([url]) => url.pathname.endsWith('/refresh_credential'))).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(sessionFile(), 'utf8'))).toMatchObject({ musickey: 'new-key', musickey_create_time: now, key_expires_in: 3 * 86400 });
});
it('refreshes once and retries a rejected playback call even without local key timing', async () => {
  const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
    if (url.pathname.endsWith('/detail')) return response({ track: raw });
    if (url.pathname.endsWith('/refresh_credential')) return response({ musicid: 123, musickey: 'renewed-key', expired_at: Math.floor(Date.now() / 1000) + 3600 });
    return (options.headers as Record<string, string>).Cookie.includes('renewed-key') ? mediaResponse() : new Response('{"code":-1}', { status: 401 });
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(qq.qqMediaUrl('qq-track123', 'standard')).resolves.toMatchObject({ level: 'standard' });
  expect(fetcher.mock.calls.map(([url]) => url.pathname)).toEqual(['/song/track123/detail', '/song/track123/url', '/login/refresh_credential', '/song/track123/url']);
});
it('shares concurrent renewals and reuses a credential already renewed by another request', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
    if (url.pathname.endsWith('/detail')) return response({ track: raw });
    if (url.pathname.endsWith('/refresh_credential')) { await gate; return response({ musicid: 123, musickey: 'renewed-key', expired_at: Math.floor(Date.now() / 1000) + 3600 }); }
    return (options.headers as Record<string, string>).Cookie.includes('renewed-key') ? mediaResponse() : new Response('{"code":-1}', { status: 401 });
  });
  vi.stubGlobal('fetch', fetcher);
  const requests = [qq.qqMediaUrl('qq-track123', 'standard'), qq.qqMediaUrl('qq-track456', 'standard')];
  await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.pathname.endsWith('/refresh_credential'))).toHaveLength(1));
  release();
  await expect(Promise.all(requests)).resolves.toHaveLength(2);
  expect(fetcher.mock.calls.filter(([url]) => url.pathname.endsWith('/refresh_credential'))).toHaveLength(1);
});
it('does not loop or erase the session when refresh is rejected, and hides upstream secrets', async () => {
  const before = fs.readFileSync(sessionFile(), 'utf8');
  const fetcher = vi.fn(async (url: URL) => url.pathname.endsWith('/detail') ? response({ track: raw }) : new Response(JSON.stringify({ code: -1, msg: 'musickey=must-not-leak' }), { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(qq.qqMediaUrl('qq-track123', 'standard')).rejects.toMatchObject({ status: 401, code: 'qq_login_expired', message: 'QQ 音乐登录已失效，请管理员重新扫码' });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fs.readFileSync(sessionFile(), 'utf8')).toBe(before);
});
it('never overwrites a new QR login with an older in-flight refresh', async () => {
  const replacement = { musicid: 456, musickey: 'new-account-key', expired_at: Math.floor(Date.now() / 1000) + 3600 };
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/detail')) return response({ track: raw });
    if (url.pathname.endsWith('/refresh_credential')) {
      fs.writeFileSync(sessionFile(), JSON.stringify(replacement));
      return response({ musicid: 123, musickey: 'old-account-refreshed' });
    }
    return new Response('{"code":-1}', { status: 401 });
  }));
  await expect(qq.qqMediaUrl('qq-track123', 'standard')).rejects.toMatchObject({ code: 'qq_session_changed' });
  expect(JSON.parse(fs.readFileSync(sessionFile(), 'utf8'))).toEqual(replacement);
});
