import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn(), songs: vi.fn(), meta: vi.fn(), qqSearch: vi.fn(), qqMeta: vi.fn() }));
vi.mock('@/server/netease', () => ({ search: mocks.search, songs: mocks.songs, songMeta: mocks.meta }));
vi.mock('@/server/qqmusic', () => ({ qqConfigured: () => true, qqSearch: mocks.qqSearch, qqSongMeta: mocks.qqMeta }));
const song = { id: '1', name: 'Song', duration: 240, cover: null, artists: [{ id: '1', name: 'Artist' }], album: { id: '1', name: 'Album' } };
let folder: string, db: typeof import('@/server/db'), catalog: typeof import('@/server/catalog');
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-catalog-')); vi.stubEnv('DATA_DIR', folder);
  db = await import('@/server/db'); catalog = await import('@/server/catalog');
});
beforeEach(() => { vi.resetAllMocks(); db.run('DELETE FROM music_sources'); });
afterAll(() => { db.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('returns results and a partial-failure notice when one search provider is unavailable', async () => {
  mocks.search.mockRejectedValue(Error('offline')); mocks.qqSearch.mockResolvedValue({ items: [{ ...song, id: 'qq-a' }], total: 50 });
  const result = await catalog.searchSongs('Song', 30, 0);
  expect(result.items[0].id).toBe('qq-a'); expect(result.warnings).toHaveLength(1); expect(result.hasMore).toBe(true); expect(result.nextOffset).toBe(30);
});
it('reranks merged providers together with uploads instead of concatenating the providers', async () => {
  const cover = { ...song, id: '2', name: '青花瓷 (DJ版)', artists: [{ id: '2', name: 'Cover' }] };
  const original = { ...song, id: 'qq-jay', name: '青花瓷', artists: [{ id: 'qq-jay', name: '周杰伦' }] };
  const uploaded = { ...cover, id: 'up-a' };
  mocks.search.mockResolvedValue({ items: [cover], total: 50 });
  mocks.qqSearch.mockResolvedValue({ items: [original], total: 80 });
  const result = await catalog.searchSongs('青花瓷', 30, 0, [uploaded]);
  expect(result.items.map(s => s.id)).toEqual(['qq-jay', '2', 'up-a']);
  expect(result).toMatchObject({ total: 130, nextOffset: 30, hasMore: true });
});
it('preserves original queue IDs and cached metadata during a provider outage', async () => {
  const { rememberSongs } = await import('@/server/recordings'); rememberSongs([song, { ...song, id: 'qq-a' }]);
  mocks.songs.mockRejectedValue(Error('offline')); mocks.qqMeta.mockResolvedValue({ ...song, id: 'qq-a' });
  const songs = await catalog.onlineSongs(['qq-a', '1']); expect(songs.map(s => s.id)).toEqual(['qq-a', '1']);
  expect(songs.every(s => s.canonicalId === '1')).toBe(true);
  mocks.meta.mockRejectedValue(Error('offline')); mocks.qqSearch.mockResolvedValue({ items: [], total: 0 });
  await expect(catalog.discoverSources('1')).resolves.toMatchObject({ canonicalId: '1', sources: [{ id: '1' }, { id: 'qq-a' }] });
});
