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
