import { INVITE_STATUS, type ListeningInvite, type ConversationSummary, type ListeningRoom, type ListeningTrack, type Message, type Person, type Playback, type SharedSong, type SocialState } from '@/lib/social-types';
import { isUploadSong } from '@/lib/upload-types';
import { all, db, now, one, run } from './db';
import { fail } from './http';
import { visibleUpload } from './uploads';

type MessageRow = Omit<Message, 'song' | 'invite'> & { song: string | null; inviteId: number | null };
function decodeMessage(viewer: number, { song, inviteId, ...message }: MessageRow): Message {
  if (inviteId) {
    const invite = one<ListeningInvite>(`SELECT id,room_id roomId,host_id hostId,guest_id guestId,status,
      created_at createdAt,updated_at updatedAt,expires_at expiresAt FROM listening_invites WHERE id=? AND (host_id=? OR guest_id=?)`, inviteId, viewer, viewer);
    if (invite) return { ...message, text: `一起听邀请 · ${INVITE_STATUS[invite.status]}`, invite };
  }
  if (!song) return message;
  const shared = JSON.parse(song) as SharedSong;
  if (isUploadSong(shared.id) && !visibleUpload(viewer, shared.id)) return { ...message, text: '歌曲已不可用' };
  return { ...message, song: shared };
}
type Friendship = { requested_by: number; accepted: number };
type RoomRow = { id: number; host_id: number; guest_id: number; host_session_id: string; guest_session_id: string | null; active: number; song_id: string | null; position: number; playing: number; updated_at: number; transport_version: number };
type Listener = { userId: number; sessionId: string };
type DirectoryRow = { id: number; username: string; name: string; avatar: string; visible: number; last_seen: number; track: string | null; requested_by: number | null; accepted: number | null };
const pair = (a: number, b: number) => a < b ? [a, b] : [b, a];
const friendship = (a: number, b: number) => one<Friendship>('SELECT requested_by,accepted FROM friendships WHERE low_id=? AND high_id=?', ...pair(a, b));
const hasActiveRoom = (user: number) => !!one('SELECT 1 FROM listening_rooms WHERE active=1 AND (host_id=? OR guest_id=?)', user, user);

function publicTrack(owner: number, track: ListeningTrack | null): ListeningTrack | null {
  if (!track || !isUploadSong(track.id)) return track;
  const upload = visibleUpload(owner, track.id);
  return upload?.visibility === 'public' ? { id: upload.id, name: upload.name, artist: upload.artist } : null;
}

function canListenTogether(host: number, guest: number, song: string) {
  return !isUploadSong(song) || (!!visibleUpload(host, song) && !!visibleUpload(guest, song));
}

function requirePeer(user: number, peer: number) {
  if (user === peer || !one("SELECT 1 FROM users WHERE id=? AND status='active'", peer)) throw fail(404, '找不到该用户');
}
function requireFriend(user: number, peer: number) {
  requirePeer(user, peer);
  if (!friendship(user, peer)?.accepted) throw fail(403, '添加好友后才能聊天或一起听');
}
function expireRooms() {
  transaction(() => {
    const time = now();
    run('DELETE FROM listening_rooms WHERE (active=1 AND updated_at<?) OR (active=0 AND updated_at<?)', time - 90_000, time - 600_000);
    run(`UPDATE listening_invites SET status=CASE WHEN status='accepted' THEN 'ended' ELSE 'expired' END,updated_at=?
      WHERE status IN ('pending','accepted') AND NOT EXISTS(SELECT 1 FROM listening_rooms r WHERE r.id=room_id)`, time);
  });
}

function transaction<T>(work: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const result = work(); db().exec('COMMIT'); return result; }
  catch (error) { db().exec('ROLLBACK'); throw error; }
}

export function socialState({ userId: user, sessionId }: Listener): SocialState {
  expireRooms();
  const time = now();
  const people = all<DirectoryRow>(`SELECT u.id,u.username,COALESCE(NULLIF(u.display_name,''),u.username) name,u.avatar,
    COALESCE(p.visible,1) visible,COALESCE(p.last_seen,0) last_seen,p.track,f.requested_by,f.accepted
    FROM users u LEFT JOIN social_presence p ON p.user_id=u.id
    LEFT JOIN friendships f ON f.low_id=min(u.id,?) AND f.high_id=max(u.id,?)
    WHERE u.status='active' ORDER BY name COLLATE NOCASE, u.id`, user, user).map((row): Person => {
    const online = row.visible ? row.last_seen > time - 35_000 : null;
    return {
      id: row.id, username: row.username, name: row.name, avatar: row.avatar ? `/api/avatars/${row.avatar}` : null, online,
      track: online && row.track ? publicTrack(row.id, JSON.parse(row.track)) : null,
      friendship: row.accepted ? 'friend' : row.requested_by === user ? 'outgoing' : row.requested_by ? 'incoming' : null,
    };
  });
  const rooms = all<RoomRow>(`SELECT r.* FROM listening_rooms r
    JOIN users host ON host.id=r.host_id AND host.status='active'
    JOIN users guest ON guest.id=r.guest_id AND guest.status='active'
    WHERE r.host_id=? OR r.guest_id=? ORDER BY r.active DESC,r.id DESC`, user, user).map((row): ListeningRoom => {
      const onThisDevice = row.host_id === user ? row.host_session_id === sessionId : !row.active || row.guest_session_id === sessionId;
      return {
        id: row.id, hostId: row.host_id, guestId: row.guest_id, active: !!row.active, onThisDevice, updatedAt: row.updated_at, transportVersion: row.transport_version,
        playback: onThisDevice && row.song_id && canListenTogether(row.host_id, row.guest_id, row.song_id)
          ? { songId: row.song_id, position: row.position, playing: !!row.playing } : null,
      };
    });
  return { people, rooms, inbox: listConversations(user), showOnline: people.find(person => person.id === user)?.online !== null, serverTime: time };
}

export function setOnlineVisibility(user: number, visible: boolean) {
  run(`INSERT INTO social_presence(user_id,visible) VALUES(?,?)
    ON CONFLICT(user_id) DO UPDATE SET visible=excluded.visible,last_seen=0,track=NULL`, user, Number(visible));
}

export function syncSocial(listener: Listener, track: ListeningTrack | null, room: number | undefined, playback: Playback | null, version = 0) {
  const { userId: user, sessionId } = listener;
  const time = now();
  const visibleTrack = publicTrack(user, track);
  if (room && playback && isUploadSong(playback.songId)) {
    const target = one<{ guest_id: number }>('SELECT guest_id FROM listening_rooms WHERE id=? AND host_id=? AND host_session_id=?', room, user, sessionId);
    if (!target || !canListenTogether(user, target.guest_id, playback.songId)) playback = null;
  }
  run(`INSERT INTO social_presence(user_id,last_seen,track) VALUES(?,?,?) ON CONFLICT(user_id)
    DO UPDATE SET last_seen=excluded.last_seen,track=excluded.track WHERE visible=1`, user, time, visibleTrack ? JSON.stringify(visibleTrack) : null);
  if (room) run(`UPDATE listening_rooms SET song_id=?,position=?,playing=?,updated_at=?
    WHERE id=? AND host_id=? AND host_session_id=? AND active=1 AND updated_at>=? AND transport_version=?`, playback?.songId ?? null, playback?.position ?? 0,
    Number(playback?.playing ?? false), time, room, user, sessionId, time - 90_000, version);
  return socialState(listener);
}

export function requestFriend(user: number, peer: number) {
  requirePeer(user, peer);
  run('INSERT OR IGNORE INTO friendships(low_id,high_id,requested_by) VALUES(?,?,?)', ...pair(user, peer), user);
}
export function answerFriend(user: number, peer: number, accept: boolean) {
  requirePeer(user, peer);
  const args = [...pair(user, peer), peer];
  const result = accept
    ? run('UPDATE friendships SET accepted=1 WHERE low_id=? AND high_id=? AND requested_by=? AND accepted=0', ...args)
    : run('DELETE FROM friendships WHERE low_id=? AND high_id=? AND requested_by=? AND accepted=0', ...args);
  if (!result.changes) throw fail(404, '好友申请已失效');
}
export function readMessages(user: number, peer: number, before?: number) {
  requireFriend(user, peer);
  expireRooms();
  const rows = all<MessageRow>(`SELECT id,sender_id senderId,text,sent_at sentAt,song,invite_id inviteId FROM friend_messages
    WHERE low_id=? AND high_id=? AND id<? ORDER BY id DESC LIMIT 50`, ...pair(user, peer), before ?? Number.MAX_SAFE_INTEGER);
  return rows.reverse().map(row => decodeMessage(user, row));
}
export function peerReadThrough(user: number, peer: number) {
  return one<{ id: number }>('SELECT message_id id FROM friend_message_reads WHERE user_id=? AND peer_id=?', peer, user)?.id ?? 0;
}
export function markMessagesRead(user: number, peer: number, through: number) {
  requireFriend(user, peer);
  const message = one<{ id: number }>('SELECT max(id) id FROM friend_messages WHERE low_id=? AND high_id=? AND sender_id=? AND id<=?', ...pair(user, peer), peer, through);
  if (!message?.id) return;
  run(`INSERT INTO friend_message_reads(user_id,peer_id,message_id) VALUES(?,?,?)
    ON CONFLICT(user_id,peer_id) DO UPDATE SET message_id=max(message_id,excluded.message_id)`, user, peer, message.id);
}
function listConversations(user: number): ConversationSummary[] {
  return all<MessageRow & Omit<ConversationSummary, 'latest'>>(`WITH pairs AS (
    SELECT f.low_id,f.high_id,CASE WHEN f.low_id=? THEN f.high_id ELSE f.low_id END peerId
    FROM friendships f WHERE f.accepted=1 AND (f.low_id=? OR f.high_id=?)
  ) SELECT p.peerId,m.id,m.sender_id senderId,m.text,m.sent_at sentAt,m.song,m.invite_id inviteId,COALESCE(other.message_id,0) peerReadThrough,
    (SELECT count(*) FROM friend_messages x WHERE x.low_id=p.low_id AND x.high_id=p.high_id AND x.sender_id=p.peerId AND x.id>COALESCE(own.message_id,0)) unread,
    COALESCE((SELECT max(x.id) FROM friend_messages x WHERE x.low_id=p.low_id AND x.high_id=p.high_id AND x.sender_id=p.peerId),0) latestIncomingId
    FROM pairs p JOIN users u ON u.id=p.peerId AND u.status='active'
    JOIN friend_messages m ON m.id=(SELECT max(x.id) FROM friend_messages x WHERE x.low_id=p.low_id AND x.high_id=p.high_id)
    LEFT JOIN friend_message_reads own ON own.user_id=? AND own.peer_id=p.peerId
    LEFT JOIN friend_message_reads other ON other.user_id=p.peerId AND other.peer_id=? ORDER BY m.id DESC`, user, user, user, user, user)
    .map(({ peerId, unread, latestIncomingId, peerReadThrough, ...latest }) => ({ peerId, unread, latestIncomingId, peerReadThrough, latest: decodeMessage(user, latest) }));
}
export function sendMessage(user: number, peer: number, text: string, song?: SharedSong): Message {
  requireFriend(user, peer);
  const sentAt = now();
  const result = run('INSERT INTO friend_messages(low_id,high_id,sender_id,text,sent_at,song) VALUES(?,?,?,?,?,?)',
    ...pair(user, peer), user, text, sentAt, song ? JSON.stringify(song) : null);
  return { id: Number(result.lastInsertRowid), senderId: user, text, sentAt, ...(song && { song }) };
}
export async function shareSong(user: number, peer: number, resolve: () => Promise<SharedSong>) {
  requireFriend(user, peer);
  const song = await resolve();
  return sendMessage(user, peer, `分享歌曲 · ${song.name}`, song);
}
export function inviteListener({ userId: user, sessionId }: Listener, peer: number) {
  requireFriend(user, peer);
  expireRooms();
  transaction(() => {
    if (hasActiveRoom(user) || hasActiveRoom(peer)) throw fail(409, '有人已加入一起听');
    const time = now();
    const result = run('INSERT OR IGNORE INTO listening_rooms(host_id,guest_id,host_session_id,updated_at) VALUES(?,?,?,?)', user, peer, sessionId, time);
    if (!result.changes) throw fail(409, '你们已有一条一起听邀请');
    const invite = run(`INSERT INTO listening_invites(room_id,host_id,guest_id,low_id,high_id,status,created_at,updated_at,expires_at)
      VALUES(?,?,?,?,?,'pending',?,?,?)`, Number(result.lastInsertRowid), user, peer, ...pair(user, peer), time, time, time + 600_000);
    run('INSERT INTO friend_messages(low_id,high_id,sender_id,text,sent_at,invite_id) VALUES(?,?,?,?,?,?)',
      ...pair(user, peer), user, '一起听邀请', time, Number(invite.lastInsertRowid));
  });
}
export function acceptListening({ userId: user, sessionId }: Listener, room: number) {
  expireRooms();
  const time = now();
  transaction(() => {
    const result = run(`UPDATE listening_rooms AS invite SET active=1,guest_session_id=?,updated_at=? WHERE id=? AND guest_id=? AND active=0
      AND EXISTS (SELECT 1 FROM users WHERE id=invite.host_id AND status='active')
      AND NOT EXISTS (SELECT 1 FROM listening_rooms AS other WHERE other.active=1 AND
        (other.host_id IN (invite.host_id,invite.guest_id) OR other.guest_id IN (invite.host_id,invite.guest_id)))`, sessionId, time, room, user);
    if (!result.changes) {
      const joined = one<{ guest_session_id: string }>('SELECT guest_session_id FROM listening_rooms WHERE id=? AND guest_id=? AND active=1', room, user);
      if (joined?.guest_session_id === sessionId) return;
      if (joined) throw fail(409, '已在另一台设备加入一起听', 'room_other_device');
    }
    if (!result.changes) throw fail(409, '邀请已失效，或有人已加入一起听');
    run("UPDATE listening_invites SET status='accepted',updated_at=? WHERE room_id=? AND status='pending'", time, room);
    const joinedRoom = one<RoomRow>('SELECT * FROM listening_rooms WHERE id=?', room)!;
    run(`DELETE FROM listening_rooms WHERE active=0 AND (host_id IN (?,?) OR guest_id IN (?,?))`,
      joinedRoom.host_id, joinedRoom.guest_id, joinedRoom.host_id, joinedRoom.guest_id);
    run(`UPDATE listening_invites SET status='expired',updated_at=? WHERE status='pending'
      AND NOT EXISTS(SELECT 1 FROM listening_rooms r WHERE r.id=room_id)`, time);
  });
}
export function controlListening({ userId: user, sessionId }: Listener, room: number, song: string, playing?: boolean) {
  const time = now();
  const target = playing === undefined ? null : Number(playing);
  const result = run(`UPDATE listening_rooms SET position=min(86400,position+CASE WHEN playing=1 THEN max(0,?-updated_at)/1000.0 ELSE 0 END),
    playing=COALESCE(?,1-playing),updated_at=?,transport_version=transport_version+1
    WHERE id=? AND song_id=? AND active=1 AND ((host_id=? AND host_session_id=?) OR (guest_id=? AND guest_session_id=?)) AND updated_at>=?
    AND (? IS NULL OR playing<>?)`, time, target, time, room, song, user, sessionId, user, sessionId, time - 90_000, target, target);
  if (!result.changes && !one(`SELECT 1 FROM listening_rooms WHERE id=? AND song_id=? AND active=1
    AND ((host_id=? AND host_session_id=?) OR (guest_id=? AND guest_session_id=?)) AND updated_at>=?`,
  room, song, user, sessionId, user, sessionId, time - 90_000)) {
    throw fail(409, '房间或歌曲已切换');
  }
}
export function leaveListening({ userId: user, sessionId }: Listener, room: number) {
  transaction(() => {
    const target = one<RoomRow>('SELECT * FROM listening_rooms WHERE id=?', room);
    const result = run(`DELETE FROM listening_rooms WHERE id=? AND
      ((host_id=? AND host_session_id=?) OR (guest_id=? AND (active=0 OR guest_session_id=?)))`,
    room, user, sessionId, user, sessionId);
    if (!result.changes && one('SELECT 1 FROM listening_rooms WHERE id=? AND (host_id=? OR guest_id=?)', room, user, user)) {
      throw fail(409, '请在参与一起听的设备上操作', 'room_other_device');
    }
    if (result.changes && target) run('UPDATE listening_invites SET status=?,updated_at=? WHERE room_id=?',
      target.active ? 'ended' : target.host_id === user ? 'cancelled' : 'declined', now(), room);
  });
}
