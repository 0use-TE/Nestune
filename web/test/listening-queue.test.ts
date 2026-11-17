import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/server/netease', () => ({ songs: vi.fn(async (ids: string[]) => ids.map(id => ({
  id, name: 'Song ' + id, artists: [{ id: '1', name: 'Artist' }], album: { id: null, name: 'Album' }, cover: null, duration: 240,
}))) }));
let database: typeof import('@/server/db');
let social: typeof import('@/server/social');
let queues: typeof import('@/server/listening-queue');
let directory: string;
let roomId: number;
const listener = (userId: number, device = 1) => ({ userId, sessionId: `u${userId}-${device}` });
const seed = { ids: ['101', '102', '101', '103'], index: 2, position: 41, playing: true, mode: 'all' };
const room = (user = 1, device = 1) => social.socialState(listener(user, device)).rooms[0];

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-room-queue-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db'); social = await import('@/server/social'); queues = await import('@/server/listening-queue');
});
beforeEach(() => {
  database.run("DELETE FROM kv WHERE key LIKE 'canvas:%'");
  database.run('DELETE FROM users');
  database.run('DELETE FROM sessions');
  for (const id of [1, 2, 3]) {
    database.run("INSERT INTO users(id,username,status,created_at) VALUES(?,?,'active',?)", id, 'u' + id, Date.now());
    for (const device of [1, 2]) database.run("INSERT INTO sessions(id,kind,user_id,created_at,expires_at,last_seen) VALUES(?,'user',?,?,?,?)",
      listener(id, device).sessionId, id, Date.now(), Date.now() + 600_000, Date.now());
  }
  social.requestFriend(1, 2); social.answerFriend(2, 1, true); social.inviteListener(listener(1), 2);
  roomId = room(2).id; social.acceptListening(listener(2), roomId);
});
afterAll(() => { database.db().close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('plays a single selection without replacing the shared queue, and reuses an existing entry', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  const original = room().queue!;
  await queues.editListeningQueue(listener(2), roomId, { type: 'playNow', songId: '104' });
  expect(room().queue!.entries.map(e => e.song.id)).toEqual(['101', '102', '101', '104', '103']);
  expect(room().playback).toMatchObject({ songId: '104', playing: true, position: 0 });
  await queues.editListeningQueue(listener(1), roomId, { type: 'playNow', songId: '102' });
  expect(room().queue!.entries).toHaveLength(5);
  expect(room().queue!.entries[1].key).toBe(original.entries[1].key);
  expect(room().playback?.songId).toBe('102');
});

it('starts from the host queue, preserving duplicate occurrences, index, mode and position', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  expect(room(2)).toMatchObject({ queue: { index: 2, mode: 'all' }, playback: { songId: '101', position: 41, playing: true } });
  expect(room(2).queue?.entries.map(entry => entry.song.id)).toEqual(seed.ids);
  expect(new Set(room(2).queue?.entries.map(entry => entry.key)).size).toBe(4);
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, ids: ['999'] });
  expect(room().queue?.entries).toHaveLength(4);
});

it('keeps concurrent additions and removes exactly the selected duplicate without resetting playback', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  await Promise.all([queues.editListeningQueue(listener(1), roomId, { type: 'append', songId: '104' }),
    queues.editListeningQueue(listener(2), roomId, { type: 'append', songId: '105' })]);
  const queue = room().queue!;
  expect(queue.entries.map(entry => entry.song.id)).toEqual(['101', '102', '101', '103', '104', '105']);
  await queues.editListeningQueue(listener(2), roomId, { type: 'remove', key: queue.entries[0].key });
  expect(room().queue?.entries[1].key).toBe(queue.entries[2].key);
  expect(room().queue?.index).toBe(1);
  expect(room().playback?.position).toBeGreaterThanOrEqual(41);
  await queues.editListeningQueue(listener(2), roomId, { type: 'remove', key: queue.entries[2].key });
  expect(room()).toMatchObject({ queue: { index: 1 }, playback: { songId: '103', position: 0 } });
});

it('lets both users jump, seek and switch modes, and rejects stale host heartbeats', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  const before = room();
  await queues.editListeningQueue(listener(2), roomId, { type: 'jump', key: before.queue!.entries[3].key });
  social.syncSocial(listener(1), null, roomId, { songId: '101', position: 99, playing: false }, before.transportVersion);
  expect(room()).toMatchObject({ queue: { index: 3 }, playback: { songId: '103', position: 0, playing: true } });
  social.syncSocial(listener(1), null, roomId, { songId: '101', position: 99, playing: false }, room().transportVersion);
  expect(room().playback?.songId).toBe('103');
  await queues.editListeningQueue(listener(2), roomId, { type: 'seek', position: 17 });
  expect(room().playback?.position).toBe(17);
  await queues.editListeningQueue(listener(1), roomId, { type: 'mode' });
  expect(room(2).queue?.mode).toBe('one');
});

it('advances automatically only once on the host and lets a guest advance manually', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, index: 0 });
  const command = { type: 'next', automatic: true, version: room().transportVersion };
  await queues.editListeningQueue(listener(2), roomId, command);
  expect(room().queue?.index).toBe(0);
  await queues.editListeningQueue(listener(1), roomId, command);
  await queues.editListeningQueue(listener(1), roomId, command);
  expect(room().queue?.index).toBe(1);
  await queues.editListeningQueue(listener(2), roomId, { type: 'next' });
  expect(room().queue?.index).toBe(2);
});

it('clears and refills the shared list without overwriting either personal list or ending the room', async () => {
  for (const id of [1, 2]) database.run('INSERT INTO queue(user_id,data) VALUES(?,?)', id, JSON.stringify({ ids: [String(200 + id)], index: 0, position: 12 }));
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  await queues.editListeningQueue(listener(2), roomId, { type: 'clear' });
  expect(room()).toMatchObject({ queue: { entries: [], index: -1 }, playback: null, active: true });
  database.run('UPDATE listening_rooms SET updated_at=? WHERE id=?', Date.now() - 50_000, roomId);
  social.syncSocial(listener(1), null, roomId, null, room().transportVersion);
  expect(room().active).toBe(true);
  expect(room().updatedAt).toBeGreaterThan(Date.now() - 1000);
  await queues.editListeningQueue(listener(2), roomId, { type: 'append', songId: '106' });
  expect(room()).toMatchObject({ queue: { index: 0 }, playback: { songId: '106', playing: false } });
  social.leaveListening(listener(2), roomId);
  expect(database.all('SELECT data FROM queue ORDER BY user_id')).toEqual([1, 2].map(id => ({ data: JSON.stringify({ ids: [String(200 + id)], index: 0, position: 12 }) })));
});

it('enforces device ownership, keeps queue contents private and saves a personal playlist', async () => {
  await expect(queues.initializeListeningQueue(listener(2), roomId, seed)).rejects.toThrow();
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  for (const actor of [listener(3), listener(1, 2), listener(2, 2)]) {
    await expect(queues.editListeningQueue(actor, roomId, { type: 'clear' })).rejects.toThrow();
    expect(() => queues.saveListeningQueue(actor, roomId, 'Mine')).toThrow();
  }
  expect(room(1, 2).queue).toBeNull();
  const saved = queues.saveListeningQueue(listener(2), roomId, 'Together');
  expect(saved.trackCount).toBe(3);
  expect(database.one('SELECT user_id FROM playlists WHERE id=?', saved.id)).toEqual({ user_id: 2 });
  expect(database.all('SELECT song_id FROM playlist_songs WHERE playlist_id=? ORDER BY added_at', saved.id).map(row => row.song_id)).toEqual(['101', '102', '103']);
  await expect(queues.editListeningQueue(listener(2), roomId, { type: 'seek', position: Infinity })).rejects.toThrow();
});

it('does not disclose a private upload through seeding, addition or later permission changes', async () => {
  const id = 'upload-' + 'a'.repeat(32);
  database.run(`INSERT INTO uploaded_songs(id,owner_id,name,artist,album,lyricist,composer,lyrics,visibility,duration,audio_ext,audio_size,created_at)
    VALUES(?,1,'Private','Artist','','','','','private',120,'wav',100,?)`, id, Date.now());
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, ids: ['101', id], index: 0 });
  expect(room(2).queue?.entries).toHaveLength(1);
  await expect(queues.editListeningQueue(listener(1), roomId, { type: 'append', songId: id })).rejects.toThrow(/分享/);
  database.run("UPDATE uploaded_songs SET visibility='public' WHERE id=?", id);
  await queues.editListeningQueue(listener(1), roomId, { type: 'append', songId: id });
  expect(room(2).queue?.entries).toHaveLength(2);
  database.run("UPDATE uploaded_songs SET visibility='private' WHERE id=?", id);
  expect(room(2).queue?.entries).toHaveLength(1);
});

it('omits a known room queue until its revision changes and never reuses another device queue', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, seed);
  const first = social.socialUpdate(listener(2));
  const revision = first.rooms[0].transportVersion;
  const next = social.socialUpdate(listener(2), { peopleVersion: first.peopleVersion, queues: { [roomId]: revision } });
  expect(next.rooms[0]).toMatchObject({ queue: null, queueUnchanged: true });
  expect(next.people).toBeUndefined();
  expect(social.socialUpdate(listener(2, 2), { queues: { [roomId]: revision } }).rooms[0].queueUnchanged).toBeUndefined();
  await queues.editListeningQueue(listener(1), roomId, { type: 'append', songId: '105' });
  const changed = social.socialUpdate(listener(2), { queues: { [roomId]: revision } });
  expect(changed.rooms[0].queueUnchanged).toBeUndefined();
  expect(changed.rooms[0].queue!.entries.at(-1)!.song.id).toBe('105');
});

it('appends a whole batch after every existing entry, preserving duplicates, paused state, mode and position', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, playing: false });
  const before = room().queue!;
  await queues.editListeningQueue(listener(2), roomId, { type: 'appendMany', songIds: ['105','104','105'] });
  expect(room().queue!.entries.slice(0, before.entries.length)).toEqual(before.entries);
  expect(room().queue!.entries.map(e => e.song.id)).toEqual([...seed.ids,'105','104','105']);
  expect(room()).toMatchObject({ queue: { index: 2, mode: 'all' }, playback: { songId: '101', position: 41, playing: false } });
});
it('starts a batch only when the shared queue is empty and preserves concurrent batches', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, ids: [], index: 0, position: 0, playing: false });
  await Promise.all([
    queues.editListeningQueue(listener(1), roomId, { type: 'appendMany', songIds: ['104','105'] }),
    queues.editListeningQueue(listener(2), roomId, { type: 'appendMany', songIds: ['106','107'] }),
  ]);
  expect(room().queue!.entries.map(e => e.song.id)).toEqual(['104','105','106','107']);
  expect(room()).toMatchObject({ queue: { index: 0 }, playback: { songId: '104', playing: true } });
});
it('rejects oversized batches without changing playback or any existing entries', async () => {
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, playing: false });
  const before = room();
  await expect(queues.editListeningQueue(listener(2), roomId, { type: 'appendMany', songIds: Array(497).fill('104') })).rejects.toThrow('500');
  expect(room().queue).toEqual(before.queue); expect(room().playback).toEqual(before.playback);
});
it('claims a canvas bundle exactly once and appends it in order without changing current playback', async () => {
  const canvas = await import('@/server/canvas');
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, playing: false });
  const board = await canvas.addRecord(1, { kind: 'queue', songIds: ['105','104','105'], x: 200, y: 200 });
  const id = board.records[0].id;
  const results = await Promise.allSettled([
    queues.editListeningQueue(listener(1), roomId, { type: 'appendCanvas', id }),
    queues.editListeningQueue(listener(2), roomId, { type: 'appendCanvas', id }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(canvas.readCanvas().records).toHaveLength(0);
  expect(room().queue!.entries.map(e => e.song.id)).toEqual([...seed.ids,'105','104','105']);
  expect(room().playback).toMatchObject({ songId: '101', position: 41, playing: false });
});
it('keeps canvas music on the board when a full shared queue cannot accept it', async () => {
  const canvas = await import('@/server/canvas');
  await queues.initializeListeningQueue(listener(1), roomId, { ...seed, ids: Array(500).fill('101'), playing: false });
  const board = await canvas.addRecord(1, { kind: 'queue', songIds: ['105','104'], x: 200, y: 200 });
  const before = room().queue;
  await expect(queues.editListeningQueue(listener(2), roomId, { type: 'appendCanvas', id: board.records[0].id })).rejects.toThrow('500');
  expect(canvas.readCanvas()).toEqual(board); expect(room().queue).toEqual(before);
});
