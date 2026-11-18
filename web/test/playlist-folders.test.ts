import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
const song = (id: string) => ({ id, name: 'Song ' + id, duration: 180, artists: [{ id: '1', name: 'Singer' }], album: { id: '7', name: 'Album' }, cover: null });
vi.mock('@/server/netease', () => ({ songs: vi.fn(async (ids: string[]) => ids.map(song)), songMeta: vi.fn(async (id: string) => song(id)), album: vi.fn(async () => ({ album: { id: '7', name: 'Album', cover: null }, songs: [song('101'), song('102')] })), importablePlaylist: vi.fn(async () => ({ playlist: { name: 'Imported', cover: null, trackCount: 2 }, songs: [song('101'), song('102')], skipped: 0 })) }));
vi.mock('@/server/qqmusic', () => ({ qqPlaylist: vi.fn(async (id: string) => ({ id, provider: 'qq', name: 'QQ playlist', cover: null, songs: [song('qq-first'), song('qq-second'), song('qq-first')] })) }));
let folder: string, database: typeof import('@/server/db'), playlists: typeof import('@/server/playlists'), folders: typeof import('@/server/playlist-folders'), imports: typeof import('@/server/playlist-import');
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-folder-')); vi.stubEnv('DATA_DIR', folder);
  database = await import('@/server/db'); playlists = await import('@/server/playlists'); folders = await import('@/server/playlist-folders'); imports = await import('@/server/playlist-import');
  for (const id of [1, 2]) database.run("INSERT INTO users(id,username,status,created_at,profile_public) VALUES(?,?,'active',1,1)", id, 'user' + id);
});
beforeEach(() => { database.run('DELETE FROM playlists'); });
afterAll(() => { database.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('stores an immutable album as one folder and expands it when reading the playlist', async () => {
  const parent = playlists.createPlaylist(1, 'My folder');
  await folders.addFolder(1, parent.id, { kind: 'album', id: '7' });
  const data = playlists.getPlaylist(1, parent.id);
  expect(data.directSongs).toEqual([]); expect(data.songs.map(s => s.id)).toEqual(['101','102']);
  expect(data.folders[0]).toMatchObject({ kind: 'album', readonly: true, name: 'Album' });
  expect(data.playlist.trackCount).toBe(2);
  await expect(folders.addFolder(2, parent.id, { kind: 'album', id: '7' })).rejects.toThrow('编辑权限');
  folders.removeFolder(1, parent.id, data.folders[0].id); expect(playlists.getPlaylist(1, parent.id).songs).toEqual([]);
});
it('reads nested own playlists live and rejects indirect cycles atomically', async () => {
  const a = playlists.createPlaylist(1, 'A'), b = playlists.createPlaylist(1, 'B'), c = playlists.createPlaylist(1, 'C');
  await folders.addFolder(1, a.id, { kind: 'mine', id: String(b.id) });
  await folders.addFolder(1, b.id, { kind: 'mine', id: String(c.id) });
  await playlists.addSong(1, c.id, '101'); expect(playlists.getPlaylist(1, a.id).songs.map(s => s.id)).toEqual(['101']);
  const child = playlists.getPlaylist(1, a.id).folders[0];
  expect(child.directSongs).toEqual([]); expect(child.folders[0].directSongs.map(s => s.id)).toEqual(['101']);
  await expect(folders.addFolder(1, c.id, { kind: 'mine', id: String(a.id) })).rejects.toThrow('循环');
  expect(playlists.getPlaylist(1, c.id).folders).toEqual([]);
});
it('revokes another user’s embedded playlist when its owner makes it private', async () => {
  const a = playlists.createPlaylist(1, 'Parent'), b = playlists.createPlaylist(2, 'Shared');
  playlists.updatePlaylist(2, b.id, { isPublic: true }); await playlists.addSong(2, b.id, '101');
  await folders.addFolder(1, a.id, { kind: 'shared', id: String(b.id) });
  expect(playlists.getPlaylist(1, a.id).folders[0].readonly).toBe(true);
  playlists.updatePlaylist(2, b.id, { isPublic: false });
  expect(playlists.getPlaylist(1, a.id).songs).toEqual([]); expect(playlists.getPlaylist(1, a.id).folders[0].available).toBe(false);
  await expect(folders.addFolder(1, a.id, { kind: 'mine', id: String(b.id) })).rejects.toThrow();
});
it('determines edit access from the original owner even when an own playlist is embedded as shared', async () => {
  const parent = playlists.createPlaylist(1, 'Parent'), child = playlists.createPlaylist(1, 'My shared playlist');
  playlists.updatePlaylist(1, child.id, { isPublic: true });
  await folders.addFolder(1, parent.id, { kind: 'shared', id: String(child.id) });
  expect(playlists.getPlaylist(1, parent.id).folders[0].readonly).toBe(false);
});
it('imports all fetched songs in original order into a separate editable playlist', async () => {
  const result = await imports.importPlaylist(1, 'https://music.163.com/playlist?id=123');
  expect(result.imported).toBe(2); expect(playlists.getPlaylist(1, result.playlist.id).songs.map(s => s.id)).toEqual(['101','102']);
  expect(playlists.getPlaylist(1, result.playlist.id).folders).toEqual([]);
});
it('deduplicates repeated QQ tracks before importing them in source order', async () => {
  const result = await imports.importPlaylist(1, 'qq:123');
  expect(result.imported).toBe(2);
  expect(playlists.getPlaylist(1, result.playlist.id).songs.map(s => s.id)).toEqual(['qq-first', 'qq-second']);
});
it('recognizes the new QQ mobile share URL without fetching the share page', async () => {
  const request = vi.fn(() => { throw new Error('A complete share URL must be parsed locally'); });
  vi.stubGlobal('fetch', request);
  try {
    await expect(imports.resolvePlaylistLink('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=2386882413')).resolves.toEqual({ provider: 'qq', id: '2386882413' });
    expect(request).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
it('keeps a parent readable and removable when a live child grows beyond the addition limit', async () => {
  const parent = playlists.createPlaylist(1, 'Parent'), child = playlists.createPlaylist(1, 'Child');
  await folders.addFolder(1, parent.id, { kind: 'mine', id: String(child.id) });
  database.run('INSERT INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(?,?,?,?)', parent.id, '1', JSON.stringify(song('1')), 1);
  for (let i = 2; i <= 1001; i++) database.run('INSERT INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(?,?,?,?)', child.id, String(i), JSON.stringify(song(String(i))), i);
  expect(playlists.getPlaylist(1, parent.id).songs).toHaveLength(1001);
  expect(playlists.listPlaylists(1).find(p => p.id === parent.id)?.trackCount).toBe(1001);
  await expect(folders.addFolder(1, parent.id, { kind: 'album', id: '7' })).rejects.toThrow('1000');
  expect(playlists.getPlaylist(1, parent.id).folders).toHaveLength(1);
  folders.removeFolder(1, parent.id, playlists.getPlaylist(1, parent.id).folders[0].id);
  expect(playlists.getPlaylist(1, parent.id).songs.map(s => s.id)).toEqual(['1']);
});
it('only follows allowlisted short-link redirects and supports servers that require GET', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 405 }))
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://y.qq.com/n/ryqq/playlist/123' } }));
  vi.stubGlobal('fetch', request);
  try {
    await expect(imports.resolvePlaylistLink('https://c6.y.qq.com/base/short')).resolves.toEqual({ provider: 'qq', id: '123' });
    expect(request.mock.calls[0][1].method).toBe('HEAD'); expect(request.mock.calls[1][1].method).toBeUndefined();
    request.mockReset().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } }));
    await expect(imports.resolvePlaylistLink('https://c6.y.qq.com/base/short')).rejects.toThrow('不支持');
    expect(request).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
