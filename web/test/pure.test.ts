import { describe, expect, it } from 'vitest';
import { mergeLyrics, parseLrc, mediaData, assertMediaUrl, cover, songSummary } from '@/server/netease';
import { parseRange } from '@/server/media';
import { sniffImage } from '@/server/avatar';
import { hit, withSlot } from '@/server/ratelimit';
import { checkPasswordRule, hashPassword, newCode, normCode, verifyPassword } from '@/server/auth';
import { intParam, numericId } from '@/server/http';
import { accessFromPrivilege, clampLevel, tiersFor } from '@/server/quality';

describe('lyrics', () => {
  it('parses timestamps and ignores metadata tags', () => {
    const lines = parseLrc('[ti:Title]\n[00:01.50]hello\n[01:02.003]world\n[00:05.00]');
    expect(lines).toEqual([{ t: 1.5, text: 'hello' }, { t: 62.003, text: 'world' }]);
  });
  it('supports multiple timestamps on one line', () => {
    expect(parseLrc('[00:10.00][00:20.00]again').map(l => l.t)).toEqual([10, 20]);
  });
  it('merges translation by nearest time', () => {
    const m = mergeLyrics('[00:01.00]a\n[00:05.00]b', '[00:01.20]一\n[00:30.00]远', '');
    expect(m[0]).toMatchObject({ text: 'a', tr: '一' });
    expect(m[1].tr).toBeUndefined();
  });
});

describe('range requests', () => {
  it('handles the common shapes', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
  });
  it('rejects invalid ranges', () => {
    for (const h of ['bytes=100-', 'bytes=9-1', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=-0']) expect(parseRange(h, 100)).toBe('invalid');
  });
});

describe('audio source safety', () => {
  it('accepts only the music CDN', () => {
    expect(() => assertMediaUrl('https://m701.music.126.net/a.mp3')).not.toThrow();
    expect(() => assertMediaUrl('https://evil.example.com/a.mp3')).toThrow();
    expect(() => assertMediaUrl('https://music.126.net.evil.com/a.mp3')).toThrow();
    expect(() => assertMediaUrl('https://user:pw@m.music.126.net/a.mp3')).toThrow();
    expect(() => assertMediaUrl('file:///etc/passwd')).toThrow();
  });
  it('rejects trial and missing urls', () => {
    expect(() => mediaData({ data: [{ url: null }] })).toThrow();
    expect(() => mediaData({ data: [{ url: 'https://m.music.126.net/a.mp3', freeTrialInfo: {} }] })).toThrow();
    expect(mediaData({ data: [{ url: 'https://m.music.126.net/a.mp3', level: 'exhigh' }] }).level).toBe('exhigh');
  });
  it('only returns cover urls from the music CDN', () => {
    expect(cover('http://p1.music.126.net/x/y.jpg')).toBe('https://p1.music.126.net/x/y.jpg?param=400y400');
    expect(cover('https://evil.example.com/x.jpg')).toBeNull();
    expect(cover(undefined)).toBeNull();
  });
  it('shapes songs with a whitelist', () => {
    const s = songSummary({ id: 1, name: 'n', dt: 61500, ar: [{ id: 2, name: 'a', secret: 1 }], al: { id: 3, name: 'al', picUrl: 'https://p1.music.126.net/c.jpg' }, cookie: 'x', h: { br: 320000, size: 1 } });
    expect(s).toMatchObject({ id: '1', duration: 62, artists: [{ id: '2', name: 'a' }], qualities: [{ level: 'exhigh' }] });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(JSON.stringify(s)).not.toContain('cookie');
  });
});

describe('avatars', () => {
  it('recognises real image headers only', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]))).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
  });
});

describe('limits', () => {
  it('blocks after the budget is spent', () => {
    const k = 'test:' + Math.random();
    for (let i = 0; i < 3; i++) hit(k, 3);
    expect(() => hit(k, 3)).toThrow();
  });
  it('caps concurrent slots and releases them', async () => {
    const k = 'slot:' + Math.random();
    let release!: () => void;
    const first = withSlot(k, 1, () => new Promise<void>(r => { release = r; }));
    await expect(withSlot(k, 1, async () => 1)).rejects.toThrow();
    release(); await first;
    await expect(withSlot(k, 1, async () => 2)).resolves.toBe(2);
  });
});

describe('credentials', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('Secret123');
    expect(await verifyPassword('Secret123', h)).toBe(true);
    expect(await verifyPassword('secret123', h)).toBe(false);
    expect(h).not.toContain('Secret123');
  });
  it('enforces the password rule', () => {
    expect(() => checkPasswordRule('short1')).toThrow();
    expect(() => checkPasswordRule('onlyletters')).toThrow();
    expect(() => checkPasswordRule('12345678')).toThrow();
    expect(checkPasswordRule('abcd1234')).toBe('abcd1234');
  });
  it('generates activation codes in a typeable format', () => {
    const c = newCode();
    expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normCode(c.toLowerCase())).toBe(c.replaceAll('-', ''));
  });
});

describe('input helpers', () => {
  it('validates ids and paging', () => {
    expect(numericId('123')).toBe('123');
    expect(() => numericId('1;drop')).toThrow();
    expect(intParam(null, 30, 100)).toBe(30);
    expect(() => intParam('101', 30, 100)).toThrow();
    expect(() => intParam('-1', 30, 100)).toThrow();
  });
});

describe('quality tiers', () => {
  const cat = [
    { level: 'standard', bitrate: 128000, size: 3_400_000 }, { level: 'exhigh', bitrate: 320000, size: 8_700_000 },
    { level: 'lossless', bitrate: 943000, size: 25_600_000 }, { level: 'hires', bitrate: 2794000, size: 75_800_000 },
  ];
  it('reads access from the catalog privilege', () => {
    expect(accessFromPrivilege({ st: -200, pl: 0 })).toMatchObject({ playable: false, reason: '暂无版权' });
    expect(accessFromPrivilege({ st: 0, plLevel: 'jyeffect', pl: 999000 })).toEqual({ playable: true, max: 'hires' });
    expect(accessFromPrivilege({ st: 0, plLevel: 'exhigh' })).toEqual({ playable: true, max: 'exhigh' });
    expect(accessFromPrivilege({ st: 0, plLevel: 'none', pl: 0 }).playable).toBe(false);
    expect(accessFromPrivilege(undefined).playable).toBe(true);
  });
  it('marks each tier ok / over the user limit / not allowed / missing', () => {
    const r = tiersFor(cat.slice(0, 3), { playable: true, max: 'lossless' }, 'exhigh');
    expect(r.tiers.map(t => t.state)).toEqual(['ok', 'ok', 'over_cap', 'missing']);
    expect(r.best).toBe('exhigh');
    const low = tiersFor(cat, { playable: true, max: 'exhigh' }, 'hires');
    expect(low.tiers.map(t => t.state)).toEqual(['ok', 'ok', 'no_access', 'no_access']);
    expect(tiersFor(cat, { playable: false, max: null, reason: '暂无版权' }, 'hires').best).toBeNull();
  });
  it('shows format and size so the user can choose before downloading', () => {
    const t = tiersFor(cat, { playable: true, max: 'hires' }, 'hires').tiers.find(x => x.level === 'lossless')!;
    expect(t).toMatchObject({ label: '无损', format: 'FLAC', bitrate: 943000, size: 25_600_000 });
  });
  it('clamps a requested level to the user limit and defaults to standard', () => {
    expect(clampLevel('hires', 'exhigh')).toBe('exhigh');
    expect(clampLevel(null, 'hires', 'standard')).toBe('standard');
    expect(clampLevel('lossless', 'standard')).toBe('standard');
    expect(clampLevel('bogus', 'lossless')).toBe('standard');
  });
});
