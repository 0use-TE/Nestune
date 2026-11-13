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
