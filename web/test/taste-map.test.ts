import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';

const upstream = vi.hoisted(() => ({ genres: vi.fn(), page: vi.fn() }));
vi.mock('@/server/netease', () => ({
  session: () => ({}), discoverySongs: async () => [], songGenres: upstream.genres, tasteCenterSongs: upstream.page,
}));
vi.mock('@/server/qqmusic', () => ({ qqConfigured: () => false }));

let db: typeof import('@/server/db'), map: typeof import('@/server/taste-map')['tasteMap'], folder: string;
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-taste-map-'));
  vi.stubEnv('DATA_DIR', folder);
  db = await import('@/server/db');
  map = (await import('@/server/taste-map')).tasteMap;
  for (const id of [1, 2, 3, 4, 5]) db.run("INSERT INTO users(id,username,status,created_at) VALUES(?,?,'active',1)", id, 'u' + id);
});
afterAll(() => { db.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const song = (id: string, artist: string): Song => ({
  id, artists: [{ id: artist, name: 'Artist ' + artist }], name: 'Track ' + id,
  album: { id: '1', name: 'Album' }, duration: 200, cover: null,
});
const favorite = (user: number, track: Song) => db.run('INSERT INTO favorites VALUES(?,?,?,?)', user, track.id, JSON.stringify(track), Date.now());

it('joins artist and provider-genre centers and balances distinct playable recordings in the mix', async () => {
  favorite(1, song('301', '81'));
  db.run('INSERT INTO history(user_id,song_id,meta,played_at) VALUES(1,?,?,?)', '302', JSON.stringify(song('302', '82')), Date.now());
  favorite(1, song('up-private', '999'));
  favorite(2, song('303', '83'));
  upstream.genres.mockImplementation(async (id: string) => id === '301' ? [{ id: '99', label: '说唱' }] : []);
  const blocked = { ...song('323', '81'), access: { playable: false, max: null } };
  const shared = song('321', '81');
  const alias = song('qq-known', '81');
  for (const track of [shared, alias, blocked]) {
    const key = track.id === alias.id ? shared.id : track.id;
    db.run('INSERT INTO music_sources(source_id,recording_id,meta,updated_at) VALUES(?,?,?,?)', track.id, key, JSON.stringify(track), Date.now());
  }
  upstream.page.mockImplementation(async (kind: string, id: string) => {
    if (kind === 'tag') return [shared, song('334', '90'), song('323', '81')];
    return id === '81' ? [alias] : [song('322', '82')];
  });

  const result = await map(1);
  expect(result.centers.map(center => center.label).sort()).toEqual(['Artist 81', 'Artist 82', '说唱']);
  const overlap = result.tracks.find(track => ['321', 'qq-known'].includes(track.song.id));
  expect(overlap?.centerIds.sort()).toEqual(['artist:81', 'tag:99']);
  expect(result.mixIds.filter(id => ['321', 'qq-known'].includes(id))).toHaveLength(1);
  expect(result.mixIds).toContain('322');
  expect(result.mixIds).toContain('334');
  expect(result.mixIds.some(id => ['up-private', '323', '303'].includes(id))).toBe(false);
  expect(result.mixIds.every(id => result.tracks.some(track => track.song.id === id))).toBe(true);
});

it('returns no personal centers for a new account and retains local centers on upstream failure', async () => {
  const cold = await map(3);
  expect(cold.centers.map(c => c.id)).toEqual(['discovery:catalog']);
  expect(cold.tracks.every(t => t.unheard)).toBe(true);
  favorite(4, song('304', '84'));
  upstream.genres.mockRejectedValue(new Error('unavailable'));
  upstream.page.mockRejectedValue(new Error('unavailable'));
  const result = await map(4);
  expect(result.centers.map(center => center.label)).toContain('Artist 84');
  expect(result.mixIds).toContain('304');
});

it('fills a 36-song mix with unheard recordings before old plays and recognizes aliases beyond the profile sample', async () => {
  const old = song('qq-ancient', '85');
  const shared = song('8100', '85');
  const played = song('8200', '86');
  for (const track of [old, shared]) {
    db.run('INSERT INTO music_sources(source_id,recording_id,meta,updated_at) VALUES(?,?,?,?)', track.id, shared.id, JSON.stringify(track), 1);
  }
  const play = (track: Song, when: number) => db.run('INSERT INTO history(user_id,song_id,meta,played_at) VALUES(5,?,?,?)', track.id, JSON.stringify(track), when);
  play(old, 1);
  for (let i = 0; i < 405; i++) play(played, 2+i);
  db.run('DELETE FROM history WHERE user_id=5 AND song_id=?', old.id);
  const saved = song('8101', '85');
  favorite(5, saved);
  upstream.genres.mockResolvedValue([]);
  upstream.page.mockImplementation(async (_kind: string, id: string) => id === '85'
    ? [shared, ...Array.from({length: 48}, (_, i) => song(String(8101+i), '85'))] : [played]);
  const result = await map(5);
  expect(new Set(result.mixIds).size).toBe(36);
  expect(result.mixIds.every(id => result.tracks.find(t => t.song.id === id)?.unheard)).toBe(true);
  expect(result.tracks.find(t => t.song.id === saved.id)?.unheard).toBe(true);
  expect(result.tracks.find(t => [shared.id, old.id].includes(t.song.id))?.unheard).toBe(false);
  expect(result.tracks.find(t => t.song.id === played.id)?.unheard).toBe(false);
});
