import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/server/netease', () => ({ collectionMetadata: vi.fn(async (kind: string, id: string) => ({ name: `${kind} ${id}`, cover: null, sub: 'Artist' })) }));
let directory: string;
let database: typeof import('@/server/db');
let favorites: typeof import('@/server/collections');
let playlists: typeof import('@/server/playlists');
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-collections-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db'); favorites = await import('@/server/collections'); playlists = await import('@/server/playlists');
});
beforeEach(() => {
  database.run('DELETE FROM users'); vi.clearAllMocks();
  for (const id of [1, 2]) database.run("INSERT INTO users(id,username,status,created_at,profile_public) VALUES(?,?,'active',?,1)", id, 'u' + id, Date.now());
});
afterAll(() => { database.db().close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('keeps album and playlist bookmarks separate, idempotent and scoped to each user', async () => {
  const { collectionMetadata } = await import('@/server/netease');
  await favorites.collect(1, 'album', '101'); await favorites.collect(1, 'album', '101');
  expect(collectionMetadata).toHaveBeenCalledTimes(1);
  await favorites.collect(1, 'playlist', '101'); await favorites.collect(2, 'album', '101');
  expect(favorites.collected(1)).toHaveLength(2); expect(favorites.collected(2)).toHaveLength(1);
  expect(database.one<{ n: number }>('SELECT count(*) n FROM favorites')!.n).toBe(0);
  expect(database.one<{ n: number }>('SELECT count(*) n FROM playlist_songs')!.n).toBe(0);
  favorites.uncollect(1, 'album', '101');
  expect(favorites.isCollected(1, 'album', '101')).toBe(false);
  expect(favorites.isCollected(1, 'playlist', '101')).toBe(true);
  expect(favorites.isCollected(2, 'album', '101')).toBe(true);
});
it('rechecks shared playlist privacy and allows removing an unavailable bookmark', async () => {
  const item = playlists.createPlaylist(1, 'Public music');
  await expect(favorites.collect(2, 'shared', String(item.id))).rejects.toThrow();
  playlists.updatePlaylist(1, item.id, { isPublic: true });
  await favorites.collect(2, 'shared', String(item.id));
  expect(favorites.collected(2)[0]).toMatchObject({ name: 'Public music', available: true });
  playlists.updatePlaylist(1, item.id, { name: 'Renamed music' });
  expect(favorites.collected(2)[0].name).toBe('Renamed music');
  database.run('UPDATE users SET profile_public=0 WHERE id=1');
  expect(favorites.collected(2)[0]).toMatchObject({ name: '歌单已不可用', cover: null, available: false });
  database.run('UPDATE users SET profile_public=1 WHERE id=1');
  expect(favorites.collected(2)[0].available).toBe(true);
  playlists.deletePlaylist(1, item.id);
  expect(favorites.collected(2)[0].available).toBe(false);
  favorites.uncollect(2, 'shared', String(item.id)); expect(favorites.collected(2)).toEqual([]);
});
it('does not save failed upstream lookups and rejects invalid targets', async () => {
  const { collectionMetadata } = await import('@/server/netease');
  vi.mocked(collectionMetadata).mockRejectedValueOnce(new Error('unavailable'));
  await expect(favorites.collect(1, 'album', '999')).rejects.toThrow('unavailable');
  expect(favorites.collected(1)).toEqual([]);
  expect(favorites.collectionTarget('album', '000123')).toEqual({ kind: 'album', id: '123' });
  for (const [kind, id] of [['song','1'],['album','../1'],['shared','9007199254740992'],['playlist','0'],['album','-1']]) expect(() => favorites.collectionTarget(kind, id)).toThrow();
});
