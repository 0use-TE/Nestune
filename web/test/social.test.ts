import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let directory: string;
let database: typeof import('@/server/db');
let social: typeof import('@/server/social');
const track = { id: '101', name: 'Test song', artist: 'Test artist' };
const listener = (userId: number, device = 1) => ({ userId, sessionId: `user-${userId}-device-${device}` });

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-social-test-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db');
  social = await import('@/server/social');
});

beforeEach(() => {
  database.run('DELETE FROM sessions');
  database.run('DELETE FROM users');
  for (const [id, username, status] of [[1, 'alice', 'active'], [2, 'bob', 'active'], [3, 'chris', 'active'], [4, 'pending', 'pending']] as const) {
    database.run('INSERT INTO users(id,username,status,created_at) VALUES(?,?,?,?)', id, username, status, Date.now());
    for (const device of [1, 2]) {
      const time = Date.now();
      database.run("INSERT INTO sessions(id,kind,user_id,created_at,expires_at,last_seen) VALUES(?,'user',?,?,?,?)",
        listener(id, device).sessionId, id, time, time + 60_000, time);
    }
  }
});

afterAll(() => {
  database?.db().close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function makeFriends(a: number, b: number) {
  social.requestFriend(a, b);
  social.answerFriend(b, a, true);
}

describe('invitation history', () => {
  it('creates one private invitation card and unread message, without duplicating a repeated invitation', () => {
    makeFriends(1, 2);
    social.inviteListener(listener(1), 2);
    const [message] = social.readMessages(2, 1);
    expect(message.invite).toMatchObject({ hostId: 1, guestId: 2, status: 'pending' });
    expect(social.socialState(listener(2)).inbox[0]).toMatchObject({ unread: 1, latest: { id: message.id, invite: { status: 'pending' } } });
    expect(() => social.inviteListener(listener(1), 2)).toThrow();
    expect(social.readMessages(1, 2)).toHaveLength(1);
    expect(() => social.readMessages(3, 1)).toThrow();
    expect(() => social.acceptListening(listener(3), message.invite!.roomId)).toThrow();
    expect(social.readMessages(1, 2)[0].invite?.status).toBe('pending');
  });

  it('preserves cancelled and declined cards and allows a fresh invitation', () => {
    makeFriends(1, 2);
    social.inviteListener(listener(1), 2);
    const first = social.readMessages(1, 2)[0];
    expect(() => social.leaveListening(listener(1, 2), first.invite!.roomId)).toThrow();
    expect(social.readMessages(2, 1)[0].invite?.status).toBe('pending');
    social.leaveListening(listener(1), first.invite!.roomId);
    expect(social.readMessages(2, 1)[0].invite?.status).toBe('cancelled');
    social.inviteListener(listener(1), 2);
    const next = social.readMessages(2, 1)[1];
    expect(next.invite?.roomId).not.toBe(first.invite?.roomId);
    social.leaveListening(listener(2), next.invite!.roomId);
    expect(social.readMessages(1, 2).map(message => message.invite?.status)).toEqual(['cancelled', 'declined']);
  });

  it('expires unanswered invitations and rejects accepting them after the deadline', () => {
    makeFriends(1, 2);
    social.inviteListener(listener(1), 2);
    const card = social.readMessages(2, 1)[0];
    database.run('UPDATE listening_rooms SET updated_at=? WHERE id=?', Date.now() - 600_001, card.invite!.roomId);
    expect(social.readMessages(2, 1)[0]).toMatchObject({ id: card.id, invite: { status: 'expired' } });
    expect(() => social.acceptListening(listener(2), card.invite!.roomId)).toThrow(/失效/);
    expect(social.socialState(listener(1)).rooms).toHaveLength(0);
  });

  it('records accepting and ending a session, and invalidates competing invitations', () => {
    makeFriends(1, 2); makeFriends(1, 3);
    social.inviteListener(listener(1), 2); social.inviteListener(listener(1), 3);
    const card = social.readMessages(1, 2)[0];
    social.acceptListening(listener(2), card.invite!.roomId);
    expect(social.readMessages(1, 2)[0]).toMatchObject({ id: card.id, invite: { status: 'accepted' } });
    expect(social.readMessages(1, 3)[0].invite?.status).toBe('expired');
    social.leaveListening(listener(2), card.invite!.roomId);
    expect(social.readMessages(1, 2)[0].invite?.status).toBe('ended');
  });

  it('keeps an invitation record after a participant signs out', () => {
    makeFriends(1, 2); social.inviteListener(listener(1), 2);
    const card = social.readMessages(2, 1)[0];
    social.acceptListening(listener(2), card.invite!.roomId);
    database.run('DELETE FROM sessions WHERE id=?', listener(2).sessionId);
    expect(social.readMessages(1, 2)[0].invite?.status).toBe('ended');
  });

  it('backfills an old live invitation once across database reopenings', () => {
    makeFriends(1, 2);
    database.run('INSERT INTO listening_rooms(host_id,guest_id,host_session_id,updated_at) VALUES(?,?,?,?)', 1, 2, listener(1).sessionId, Date.now());
    for (let i = 0; i < 2; i++) {
      database.db().close();
      delete (globalThis as { __nt_db?: unknown }).__nt_db;
      expect(social.readMessages(2, 1)).toHaveLength(1);
      expect(social.readMessages(2, 1)[0].invite?.status).toBe('pending');
    }
  });
});

describe('social visibility and permissions', () => {
  it('lists all enabled users and never leaks hidden activity through later heartbeats', () => {
    social.syncSocial(listener(1), track, undefined, null);
    const initial = social.socialState(listener(2));
    expect(initial.people.map(person => person.id)).toEqual([1, 2, 3]);
    expect(initial.people[0]).toMatchObject({ online: true, track });
    expect(initial.people[2]).toMatchObject({ online: false, track: null });
    social.setOnlineVisibility(1, false);
    expect(social.syncSocial(listener(1), track, undefined, null).showOnline).toBe(false);
    expect(social.socialState(listener(2)).people[0]).toMatchObject({ online: null, track: null });
  });

  it('requires a recipient to accept friendship before either side can send or read messages', () => {
    social.requestFriend(1, 2);
    expect(() => social.answerFriend(1, 2, true)).toThrow();
    expect(() => social.sendMessage(1, 2, 'hello')).toThrow();
    social.answerFriend(2, 1, true);
    const message = social.sendMessage(1, 2, 'hello');
    expect(social.readMessages(2, 1)).toEqual([message]);
    expect(social.readMessages(2, 1, message.id)).toEqual([]);
    expect(() => social.readMessages(3, 2)).toThrow();
  });

  it('counts only received unread messages and advances read receipts without moving backwards', () => {
    makeFriends(1, 2);
    const first = social.sendMessage(1, 2, 'first');
    const second = social.sendMessage(1, 2, 'second');
    social.sendMessage(2, 1, 'reply');
    expect(social.socialState(listener(2)).inbox[0]).toMatchObject({ unread: 2, latestIncomingId: second.id });
    expect(social.peerReadThrough(1, 2)).toBe(0);
    social.markMessagesRead(2, 1, first.id);
    expect(social.socialState(listener(2)).inbox[0].unread).toBe(1);
    social.markMessagesRead(2, 1, second.id);
    social.markMessagesRead(2, 1, first.id);
    expect(social.socialState(listener(2)).inbox[0].unread).toBe(0);
    expect(social.peerReadThrough(1, 2)).toBe(second.id);
    expect(() => social.markMessagesRead(3, 1, second.id)).toThrow();
  });

  it('shares songs with friends through the existing history, inbox, and read receipts', async () => {
    const song = { ...track, cover: null };
    const resolve = vi.fn(async () => song);
    await expect(social.shareSong(1, 2, resolve)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();

    makeFriends(1, 2);
    const text = social.sendMessage(1, 2, 'hello');
    const shared = await social.shareSong(1, 2, resolve);
    expect(shared).toMatchObject({ song, text: '分享歌曲 · Test song' });
    expect(social.readMessages(2, 1)).toEqual([text, shared]);
    expect(social.readMessages(2, 1, shared.id)).toEqual([text]);
    expect(social.socialState(listener(2)).inbox[0]).toMatchObject({ latest: shared, unread: 2 });
    social.markMessagesRead(2, 1, shared.id);
    expect(social.peerReadThrough(1, 2)).toBe(shared.id);
    expect(() => social.readMessages(3, 1)).toThrow();
  });

  it('keeps listening rooms private and two-person, and accepts playback updates only from the host', () => {
    makeFriends(1, 2);
    makeFriends(1, 3);
    social.inviteListener(listener(1), 2);
    social.inviteListener(listener(1), 3);
    const room = social.socialState(listener(2)).rooms[0];
    const competing = social.socialState(listener(3)).rooms[0];
    expect(() => social.acceptListening(listener(3), room.id)).toThrow();
    social.acceptListening(listener(2), room.id);
    expect(() => social.acceptListening(listener(3), competing.id)).toThrow();
    const playback = { songId: track.id, position: 13, playing: true };
    social.syncSocial(listener(1), track, room.id, playback);
    social.syncSocial(listener(2), null, room.id, { ...playback, position: 90 });
    expect(social.socialState(listener(2)).rooms[0].playback).toEqual(playback);
    expect(social.socialState(listener(3)).rooms.some(item => item.id === room.id)).toBe(false);
    social.leaveListening(listener(3), room.id);
    expect(social.socialState(listener(1)).rooms[0].active).toBe(true);
    social.leaveListening(listener(2), room.id);
    expect(social.socialState(listener(1)).rooms.some(item => item.active)).toBe(false);
  });

  it('lets both listeners control transport and prevents an older host sync from undoing a command', () => {
    makeFriends(1, 2);
    social.inviteListener(listener(1), 2);
    const room = social.socialState(listener(2)).rooms[0];
    social.acceptListening(listener(2), room.id);
    social.syncSocial(listener(1), track, room.id, { songId: track.id, position: 13, playing: true });
    expect(() => social.controlListening(listener(3), room.id, track.id, false)).toThrow();
    social.controlListening(listener(2), room.id, track.id, false);
    social.syncSocial(listener(1), track, room.id, { songId: track.id, position: 20, playing: true }, 0);
    expect(social.socialState(listener(1)).rooms[0]).toMatchObject({ transportVersion: 1, playback: { playing: false } });
    social.controlListening(listener(1), room.id, track.id);
    expect(social.socialState(listener(2)).rooms[0]).toMatchObject({ transportVersion: 2, playback: { playing: true } });
    expect(() => social.controlListening(listener(2), room.id, '999', false)).toThrow();
  });

  it('allows only the inviting and first accepting sessions to participate', () => {
    makeFriends(1, 2);
    const host = listener(1);
    const otherHost = listener(1, 2);
    const guest = listener(2);
    const otherGuest = listener(2, 2);
    social.inviteListener(host, 2);
    const { id } = social.socialState(guest).rooms[0];
    expect(social.socialState(otherGuest).rooms[0]).toMatchObject({ id, active: false, onThisDevice: true });
    expect(social.socialState(otherHost).rooms[0]).toMatchObject({ id, active: false, onThisDevice: false });
    expect(() => social.leaveListening(otherHost, id)).toThrow();

    social.acceptListening(guest, id);
    expect(() => social.acceptListening(guest, id)).not.toThrow();
    expect(() => social.acceptListening(otherGuest, id)).toThrow(/另一台设备/);
    const playback = { songId: track.id, position: 13, playing: true };
    social.syncSocial(host, track, id, playback);
    social.syncSocial(otherHost, null, id, null);
    expect(social.socialState(guest).rooms[0]).toMatchObject({ active: true, onThisDevice: true, playback });
    for (const other of [otherHost, otherGuest]) {
      expect(social.socialState(other).rooms[0]).toMatchObject({ active: true, onThisDevice: false, playback: null });
      expect(() => social.controlListening(other, id, track.id, false)).toThrow();
      expect(() => social.leaveListening(other, id)).toThrow();
    }
    social.controlListening(guest, id, track.id, false);
    expect(social.socialState(host).rooms[0].playback?.playing).toBe(false);
    database.run('DELETE FROM sessions WHERE id=?', otherGuest.sessionId);
    expect(social.socialState(host).rooms).toHaveLength(1);
    database.run('DELETE FROM sessions WHERE id=?', guest.sessionId);
    expect(social.socialState(host).rooms).toHaveLength(0);
  });
});
