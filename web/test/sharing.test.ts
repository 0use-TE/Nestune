import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

let directory: string;
let database: typeof import('@/server/db');
let playlists: typeof import('@/server/playlists');
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-sharing-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db'); playlists = await import('@/server/playlists');
});
beforeEach(() => {
  database.run('DELETE FROM users');
  for (const id of [1, 2]) database.run("INSERT INTO users(id,username,display_name,bio,email,pwd_hash,status,created_at) VALUES(?,?,?,'Bio','private@example.com','secret','active',?)", id, 'user' + id, 'User ' + id, Date.now());
});
afterAll(() => { database.db().close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('keeps playlists private until explicitly shared, and immediately revokes old links', () => {
  const p = playlists.createPlaylist(1, 'Mix');
  expect(p.isPublic).toBe(false);
  expect(() => playlists.sharedPlaylist(2, p.id)).toThrow();
  playlists.updatePlaylist(1, p.id, { isPublic: true });
  expect(playlists.personProfile(2, 1).playlists.map(p => p.id)).toEqual([p.id]);
  expect(playlists.sharedPlaylist(2, p.id).owner.name).toBe('User 1');
  expect(() => playlists.updatePlaylist(2, p.id, { isPublic: false })).toThrow();
  database.run('UPDATE users SET profile_public=0 WHERE id=1');
  expect(() => playlists.personProfile(2, 1)).toThrow();
  expect(() => playlists.sharedPlaylist(2, p.id)).toThrow();
  database.run('UPDATE users SET profile_public=1 WHERE id=1');
  playlists.updatePlaylist(1, p.id, { isPublic: false });
  expect(() => playlists.sharedPlaylist(2, p.id)).toThrow();
});

it('copies every favorite in display order, skips recording aliases, and is safe to repeat', async () => {
  const { rememberSongs } = await import('@/server/recordings');
  const target = playlists.createPlaylist(1, 'All likes');
  const song = (id: string, name: string) => ({ id, name, duration: 180, artists: [{ id: '1', name: 'Artist' }], album: { id: '1', name: 'Album' }, cover: null });
  const existing = song('82000', 'Same recording');
  const alias = song('qq-bulkcopy', 'Same recording');
  rememberSongs([existing, alias]);
  database.run('INSERT INTO playlist_songs VALUES(?,?,?,?)', target.id, existing.id, JSON.stringify(existing), 1);
  for (let i = 1; i <= 105; i++) {
    const favorite = song(String(82000 + i), `Track ${i}`);
    database.run('INSERT INTO favorites(user_id,song_id,meta,created_at) VALUES(?,?,?,?)', 1, favorite.id, JSON.stringify(favorite), i);
  }
  database.run('INSERT INTO favorites(user_id,song_id,meta,created_at) VALUES(?,?,?,?)', 1, alias.id, JSON.stringify(alias), 999);
  expect(() => playlists.addFavoritesToPlaylist(2, target.id)).toThrow();
  expect(playlists.addFavoritesToPlaylist(1, target.id)).toEqual({ added: 105, skipped: 1 });
  expect(playlists.getPlaylist(1, target.id).songs.map(s => s.id)).toEqual([existing.id, ...Array.from({ length: 105 }, (_, i) => String(82105 - i))]);
  expect(playlists.addFavoritesToPlaylist(1, target.id)).toEqual({ added: 0, skipped: 106 });
});

it('never exposes account fields or private uploaded song metadata through a public playlist', () => {
  const p = playlists.createPlaylist(1, 'Mixed visibility');
  const privateId = 'upload-' + 'a'.repeat(32);
  database.run(`INSERT INTO uploaded_songs(id,owner_id,name,artist,album,lyricist,composer,lyrics,visibility,duration,audio_ext,audio_size,created_at)
    VALUES(?,1,'Secret recording','Secret artist','Secret album','','','','private',30,'mp3',123,?)`, privateId, Date.now());
  const song = (id: string, name: string) => ({ id, name, duration: 30, artists: [], album: { id: null, name: '' }, cover: '/private-cover' });
  database.run('INSERT INTO playlist_songs VALUES(?,?,?,?)', p.id, privateId, JSON.stringify(song(privateId, 'Secret recording')), 1);
  database.run('INSERT INTO playlist_songs VALUES(?,?,?,?)', p.id, '100', JSON.stringify({ ...song('100', 'Public song'), cover: '/public-cover' }), 2);
  playlists.updatePlaylist(1, p.id, { isPublic: true });
  const shared = playlists.sharedPlaylist(2, p.id);
  expect(shared.songs.map(s => s.id)).toEqual(['100']);
  expect(shared.playlist).toMatchObject({ trackCount: 1, cover: '/public-cover' });
  const profile = playlists.personProfile(2, 1);
  expect(profile.person).not.toHaveProperty('email'); expect(profile.person).not.toHaveProperty('pwd_hash');
  expect(JSON.stringify(profile)).not.toContain('Secret');
  expect(playlists.getPlaylist(1, p.id).songs).toHaveLength(2);
});
