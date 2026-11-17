import { afterEach, expect, it, vi } from 'vitest';
import { artistSongs } from '@/server/netease';
const globals = globalThis as typeof globalThis & { __nt_up?: unknown; __nt_sess?: unknown; __nt_meta?: unknown };
const previous = { upstream: globals.__nt_up, session: globals.__nt_sess, metadata: globals.__nt_meta };
afterEach(() => { globals.__nt_up = previous.upstream; globals.__nt_sess = previous.session; globals.__nt_meta = previous.metadata; });
it('lists the public artist catalog anonymously and applies the bound account permissions separately', async () => {
  const catalog = vi.fn(async () => ({ body: { code: 200, songs: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }], more: true, total: 200 } }));
  const detail = vi.fn(async () => ({ body: { code: 200, songs: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }], privileges: [{ id: 1, st: 0, pl: 320000 }, { id: 2, st: -1, pl: 0 }] } }));
  globals.__nt_up = { artist_songs: catalog, song_detail: detail }; globals.__nt_sess = { cookie: 'MUSIC_U=test-session-only' }; globals.__nt_meta = new Map();
  const page = await artistSongs('3684', 100, 100);
  expect(catalog).toHaveBeenCalledWith(expect.objectContaining({ id: '3684', limit: 100, offset: 100, cookie: {} }));
  expect(detail).toHaveBeenCalledWith(expect.objectContaining({ cookie: 'MUSIC_U=test-session-only' }));
  expect(page.more).toBe(true); expect(page.total).toBe(200);
  expect(page.songs.map(song => song.access.playable)).toEqual([true, false]);
});
