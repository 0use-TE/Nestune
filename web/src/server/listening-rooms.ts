import { LISTENING_ROOM_CAPACITY, type Message } from '@/lib/social-types';
import { all, db, now, one, run } from './db';
import { fail } from './http';

export type Listener = { userId: number; sessionId: string };
export type Room = {
  id: number; host_id: number; guest_id: number; host_session_id: string; guest_session_id: string | null;
  active: number; group_room: number; queue_data: string | null; song_id: string | null;
  position: number; playing: number; updated_at: number; transport_version: number; playback_version: number;
};
const MEMBER_TIMEOUT = 120_000;
const INVITE_TIMEOUT = 600_000;

export function roomTransaction<T>(work: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const result = work(); db().exec('COMMIT'); return result; }
  catch (error) { db().exec('ROLLBACK'); throw error; }
}

export function groupRoom(id: number) {
  return one<Room>('SELECT * FROM listening_rooms WHERE id=? AND group_room=1', id);
}

export function groupMembers(id: number) {
  return all<{ user_id: number; session_id: string }>('SELECT user_id,session_id FROM listening_room_members WHERE room_id=? ORDER BY joined_at,user_id', id);
}

export function pendingGroupGuests(id: number) {
  return all<{ guest_id: number }>("SELECT guest_id FROM listening_invites WHERE room_id=? AND status='pending' ORDER BY id", id).map(row => row.guest_id);
}

export function groupRoomAudience(id: number, includeInvited = false) {
  if (!groupRoom(id)) return [];
  const users = groupMembers(id).map(member => member.user_id);
  return includeInvited ? [...users, ...pendingGroupGuests(id)] : users;
}

export function hasListeningRoom(user: number) {
  return !!one(`SELECT 1 FROM listening_room_members WHERE user_id=?
    UNION ALL SELECT 1 FROM listening_rooms WHERE group_room=0 AND active=1 AND (host_id=? OR guest_id=?)`, user, user, user);
}

export function requireGroupMember(listener: Listener, room: number) {
  if (!one('SELECT 1 FROM listening_room_members WHERE room_id=? AND user_id=? AND session_id=?', room, listener.userId, listener.sessionId)) {
    throw fail(403, '请在参与一起听的设备上操作');
  }
}

function join(room: number, listener: Listener, time: number) {
  run('INSERT INTO listening_room_members(room_id,user_id,session_id,joined_at,last_seen) VALUES(?,?,?,?,?)',
    room, listener.userId, listener.sessionId, time, time);
  run("UPDATE listening_invites SET status='expired',updated_at=? WHERE guest_id=? AND room_id<>? AND status='pending'", time, listener.userId, room);
  run('DELETE FROM listening_rooms WHERE group_room=0 AND active=0 AND (host_id=? OR guest_id=?)', listener.userId, listener.userId);
}

export function createGroupRoom(listener: Listener) {
  return roomTransaction(() => {
    const existing = one<{ room_id: number; session_id: string }>('SELECT room_id,session_id FROM listening_room_members WHERE user_id=?', listener.userId);
    if (existing?.session_id === listener.sessionId) return existing.room_id;
    if (hasListeningRoom(listener.userId)) throw fail(409, '你已加入一起听');
    const time = now();
    const id = Number(run('INSERT INTO listening_rooms(host_id,guest_id,active,updated_at,group_room) VALUES(?,?,1,?,1)',
      listener.userId, listener.userId, time).lastInsertRowid);
    join(id, listener, time);
    return id;
  });
}

export function inviteGroupGuest(listener: Listener, id: number, peer: number) {
  roomTransaction(() => {
    const room = groupRoom(id);
    requireGroupMember(listener, id);
    if (!room || room.host_id !== listener.userId) throw fail(403, '请由房主发出邀请');
    const [low, high] = [Math.min(listener.userId, peer), Math.max(listener.userId, peer)];
    if (!one(`SELECT 1 FROM friendships f JOIN users u ON u.id=? AND u.status='active'
      WHERE low_id=? AND high_id=? AND accepted=1`, peer, low, high)) throw fail(403, '只能邀请好友');
    if (hasListeningRoom(peer)) throw fail(409, '好友已加入一起听');
    if (groupMembers(id).length >= LISTENING_ROOM_CAPACITY) throw fail(409, '房间已满');
    const time = now();
    if (pendingGroupGuests(id).includes(peer)) return;
    const invite = run(`INSERT INTO listening_invites(room_id,host_id,guest_id,low_id,high_id,status,created_at,updated_at,expires_at,group_invite)
      VALUES(?,?,?,?,?,'pending',?,?,?,1)`, id, listener.userId, peer, low, high, time, time, time + INVITE_TIMEOUT);
    run('INSERT INTO friend_messages(low_id,high_id,sender_id,text,sent_at,invite_id) VALUES(?,?,?,?,?,?)',
      low, high, listener.userId, '一起听邀请', time, Number(invite.lastInsertRowid));
  });
}

export function acceptGroupGuest(listener: Listener, id: number) {
  roomTransaction(() => {
    const existing = groupMembers(id).find(member => member.user_id === listener.userId);
    if (existing?.session_id === listener.sessionId) return;
    if (hasListeningRoom(listener.userId)) throw fail(409, '你已加入一起听');
    const time = now();
    const invite = one<{ id: number }>(`SELECT i.id FROM listening_invites i
      JOIN friendships f ON f.low_id=i.low_id AND f.high_id=i.high_id AND f.accepted=1
      WHERE i.room_id=? AND i.guest_id=? AND i.status='pending' AND i.expires_at>=?`, id, listener.userId, time);
    if (!invite) throw fail(409, '邀请已失效');
    if (groupMembers(id).length >= LISTENING_ROOM_CAPACITY) throw fail(409, '房间已满');
    join(id, listener, time);
    run("UPDATE listening_invites SET status='accepted',updated_at=? WHERE id=?", time, invite.id);
  });
}

export function leaveGroupRoom(listener: Listener, id: number, inviteId?: number) {
  roomTransaction(() => {
    const room = groupRoom(id);
    if (!room) return;
    const time = now();
    if (inviteId !== undefined) {
      const host = room.host_id === listener.userId;
      if (host) requireGroupMember(listener, id);
      run(`UPDATE listening_invites SET status=?,updated_at=? WHERE id=? AND room_id=? AND status='pending'
        AND (? OR guest_id=?)`, host ? 'cancelled' : 'declined', time, inviteId, id, Number(host), listener.userId);
      return;
    }
    requireGroupMember(listener, id);
    run('DELETE FROM listening_room_members WHERE room_id=? AND user_id=?', id, listener.userId);
    run("UPDATE listening_invites SET status='ended',updated_at=? WHERE room_id=? AND guest_id=? AND status='accepted'", time, id, listener.userId);
    if (room.host_id === listener.userId) assignGroupHost(room, time);
  });
}

function assignGroupHost(room: Room, time: number) {
  const successor = groupMembers(room.id)[0];
  run("UPDATE listening_invites SET status='cancelled',updated_at=? WHERE room_id=? AND status='pending'", time, room.id);
  if (!successor) {
    run('DELETE FROM listening_rooms WHERE id=?', room.id);
    return;
  }
  run('UPDATE listening_rooms SET host_id=?,guest_id=? WHERE id=?', successor.user_id, successor.user_id, room.id);
}

export function expireGroupRooms(time: number) {
  const expired = all<{ room_id: number; user_id: number }>(`SELECT m.room_id,m.user_id FROM listening_room_members m
    WHERE m.last_seen<? OR NOT EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=m.session_id AND s.user_id=m.user_id AND s.kind='user' AND s.expires_at>=? AND u.status='active')`, time - MEMBER_TIMEOUT, time);
  for (const member of expired) {
    run('DELETE FROM listening_room_members WHERE room_id=? AND user_id=?', member.room_id, member.user_id);
    run("UPDATE listening_invites SET status='ended',updated_at=? WHERE room_id=? AND guest_id=? AND status='accepted'", time, member.room_id, member.user_id);
  }
  const rooms = all<Room>(`SELECT * FROM listening_rooms r WHERE group_room=1
    AND NOT EXISTS(SELECT 1 FROM listening_room_members m WHERE m.room_id=r.id AND m.user_id=r.host_id)`);
  for (const room of rooms) assignGroupHost(room, time);
  run("UPDATE listening_invites SET status='expired',updated_at=? WHERE status='pending' AND expires_at<?", time, time);
}

export function touchGroupMember({ userId, sessionId }: Listener) {
  const time = now();
  run('UPDATE listening_room_members SET last_seen=? WHERE user_id=? AND session_id=? AND last_seen>=?',
    time, userId, sessionId, time - MEMBER_TIMEOUT);
}

export function groupMessages(id: number): Message[] {
  return all<Message>('SELECT id,sender_id senderId,text,sent_at sentAt FROM listening_room_messages WHERE room_id=? ORDER BY id DESC LIMIT 50', id).reverse();
}

export function sendGroupMessage(listener: Listener, id: number, text: string) {
  requireGroupMember(listener, id);
  run('INSERT INTO listening_room_messages(room_id,sender_id,text,sent_at) VALUES(?,?,?,?)', id, listener.userId, text, now());
}
