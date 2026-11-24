import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';

let directory: string;
let database: typeof import('@/server/db');
let domains: typeof import('@/server/listening-domains');
let rooms: typeof import('@/server/listening-rooms');
let social: typeof import('@/server/social');
const listener = (userId: number) => ({ userId, sessionId: `domain-user-${userId}` });
const song = (id: string): Song => ({ id, name: '歌 ' + id, artists: [], album: { id: null, name: '' }, cover: null, duration: 120 });

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-domains-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db');
  domains = await import('@/server/listening-domains');
  rooms = await import('@/server/listening-rooms');
  social = await import('@/server/social');
});

beforeEach(() => {
  database.run('DELETE FROM listening_domains');
  database.run('DELETE FROM sessions');
  database.run('DELETE FROM users');
  const now = Date.now();
  for (const id of [1, 2, 3]) {
    database.run("INSERT INTO users(id,username,status,created_at) VALUES(?,?,'active',?)", id, 'member' + id, now);
    database.run("INSERT INTO sessions(id,kind,user_id,created_at,expires_at,last_seen) VALUES(?,'user',?,?,?,?)", listener(id).sessionId, id, now, now + 600000, now);
  }
  for (const peer of [2, 3]) database.run('INSERT INTO friendships(low_id,high_id,requested_by,accepted) VALUES(1,?,1,1)', peer);
});

afterAll(() => {
  database?.db().close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('isolates two durable domains and keeps membership, conversation and songs after everybody stops listening', () => {
  const first = domains.createDomain(1, '午后');
  const second = domains.createDomain(1, '夜间');
  domains.inviteDomainMember(first, 1, 2);
  expect(domains.listDomains(2)).toMatchObject([{ id: first, invited: true }]);
  expect(() => domains.readDomain(first, 2)).toThrow(/找不到/);
  domains.answerDomainInvite(first, 2, true);
  expect(() => domains.readDomain(second, 2)).toThrow(/找不到/);
  expect(() => domains.joinDomainPlayback(listener(3), first)).toThrow(/找不到/);
  domains.sendDomainMessage(first, 2, '来听这一首', song('101'));
  expect(domains.addDomainSong(first, 2, song('101'))).toBe(true);
  expect(domains.addDomainSong(first, 1, song('101'))).toBe(false);
  expect(domains.readDomain(second, 1).songs).toEqual([]);
  const live = domains.joinDomainPlayback(listener(1), first);
  expect(social.socialState(listener(1)).rooms[0]).toMatchObject({ domain: { id:first, name:'午后' }, playback: {songId:'101',playing:false} });
  expect(() => rooms.inviteGroupGuest(listener(1), live, 3)).toThrow(/域/);
  expect(domains.joinDomainPlayback(listener(2), first)).toBe(live);
  expect(() => domains.joinDomainPlayback(listener(1), second)).toThrow(/退出/);
  expect(domains.addDomainSong(first, 2, song('102'))).toBe(true);
  expect(social.socialState(listener(1)).rooms[0].queue?.entries.map(entry => entry.song.id)).toEqual(['101','102']);
  social.leaveListening(listener(1), live);
  expect(social.socialState(listener(2)).rooms[0].hostId).toBe(2);
  social.leaveListening(listener(2), live);
  expect(rooms.groupRoom(live)).toBeUndefined();
  expect(domains.readDomain(first, 2)).toMatchObject({ memberIds:[1,2], listeners:0, songs:[{song:{id:'101'}},{song:{id:'102'}}], messages:[{song:{id:'101'}}] });
  expect(domains.joinDomainPlayback(listener(2), first)).not.toBe(live);
  domains.leaveDomain(listener(2), first);
  expect(() => domains.readDomain(first, 2)).toThrow(/找不到/);
  expect(domains.readDomain(first, 1).songs).toHaveLength(2);
});

it('keeps private uploads out of domain messages and playlists and checks the owner of a playlist entry', () => {
  const domain = domains.createDomain(1, '私密测试域');
  domains.inviteDomainMember(domain, 1, 2);
  domains.answerDomainInvite(domain, 2, true);
  const privateSong = song('upload-' + '1'.repeat(32));
  database.run(`INSERT INTO uploaded_songs(id,owner_id,name,artist,album,lyricist,composer,lyrics,visibility,duration,audio_ext,audio_size,created_at)
    VALUES(?,1,'私人录音','','','','','','private',20,'mp3',20,?)`, privateSong.id, Date.now());
  expect(() => domains.addDomainSong(domain, 1, privateSong)).toThrow(/公开/);
  expect(() => domains.sendDomainMessage(domain, 1, '', privateSong)).toThrow(/公开/);
  domains.addDomainSong(domain, 1, song('101'));
  expect(() => domains.removeDomainSong(domain, 2, '101')).toThrow(/移除/);
  domains.removeDomainSong(domain, 1, '101');
  expect(domains.readDomain(domain, 2).songs).toHaveLength(0);
});
