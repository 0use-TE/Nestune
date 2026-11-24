import { randomUUID } from 'node:crypto';
import { LISTENING_ROOM_CAPACITY, type DomainDetail, type DomainMessage, type DomainSummary, type SharedSong } from '@/lib/social-types';
import { changeQueue, type SharedQueue } from '@/lib/shared-queue';
import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { all, now, one, run } from './db';
import { fail } from './http';
import { canListenTogether, readSharedQueue } from './listening-queue';
import { dropGroupDevice, groupMembers, hasListeningRoom, joinGroupDevice, roomTransaction, type Listener, type Room } from './listening-rooms';
import { visibleUpload } from './uploads';

const PLAYLIST_LIMIT = 500;
type Domain = { id: number; name: string; owner_id: number | null };
const liveRoom = (domain: number) => one<Room>('SELECT * FROM listening_rooms WHERE domain_id=? AND active=1', domain);
const isMember = (domain: number, user: number) => !!one('SELECT 1 FROM listening_domain_members WHERE domain_id=? AND user_id=?', domain, user);
export const domainAudience = (domain: number) => all<{ user_id: number }>(
  'SELECT user_id FROM listening_domain_members WHERE domain_id=? UNION SELECT user_id FROM listening_domain_invites WHERE domain_id=?',
  domain, domain,
).map(row => row.user_id);

export function requireDomain(domain: number, user: number) {
  const row = one<Domain>('SELECT d.id,d.name,d.owner_id FROM listening_domains d JOIN listening_domain_members m ON m.domain_id=d.id WHERE d.id=? AND m.user_id=?', domain, user);
  if (!row) throw fail(404, '找不到你加入的域');
  return row;
}

function summary(domain: Domain, invited = false): DomainSummary {
  const room = invited ? undefined : liveRoom(domain.id);
  const queue = room?.queue_data ? JSON.parse(room.queue_data) as SharedQueue : null;
  const song = room && queue ? queue.entries[queue.index]?.song : undefined;
  const members = one<{ n: number }>('SELECT count(*) n FROM listening_domain_members WHERE domain_id=?', domain.id)!.n;
  return {
    id: domain.id, name: domain.name, ownerId: domain.owner_id, members, invited,
    listeners: room ? groupMembers(room.id).length : 0,
    track: room?.playing && song && canListenTogether(room, song.id) ? song.name : null,
  };
}

export function listDomains(user: number) {
  return all<Domain & { invited: number }>(`SELECT d.id,d.name,d.owner_id,0 invited FROM listening_domains d
    JOIN listening_domain_members m ON m.domain_id=d.id WHERE m.user_id=?
    UNION ALL SELECT d.id,d.name,d.owner_id,1 invited FROM listening_domains d
    JOIN listening_domain_invites i ON i.domain_id=d.id WHERE i.user_id=?
    ORDER BY id DESC`, user, user).map(domain => summary(domain, !!domain.invited));
}

function publicSong(user: number, id: string) {
  return !isUploadSong(id) || visibleUpload(user, id)?.visibility === 'public';
}

function domainSongs(domain: number, user: number) {
  return all<{ song: string; addedBy: number | null }>('SELECT song,added_by addedBy FROM listening_domain_songs WHERE domain_id=? ORDER BY id', domain)
    .map(row => ({ ...row, song: JSON.parse(row.song) as Song }))
    .filter(row => publicSong(user, row.song.id));
}

export function readDomainMessages(domain: number, user: number, before = Number.MAX_SAFE_INTEGER) {
  requireDomain(domain, user);
  const rows = all<Omit<DomainMessage, 'song'> & { song: string | null }>(`SELECT id,sender_id senderId,text,song,sent_at sentAt
    FROM listening_domain_messages WHERE domain_id=? AND id<? ORDER BY id DESC LIMIT 51`, domain, before);
  return { hasEarlier: rows.length > 50, messages: rows.slice(0, 50).reverse().map(({ song, ...message }): DomainMessage => {
    if (!song) return message;
    const card = JSON.parse(song) as SharedSong;
    return publicSong(user, card.id) ? { ...message, song: card } : { ...message, text: '歌曲已不可用' };
  }) };
}

export function readDomain(domain: number, user: number): DomainDetail {
  const row = requireDomain(domain, user);
  return {
    ...summary(row),
    memberIds: all<{ user_id: number }>('SELECT user_id FROM listening_domain_members WHERE domain_id=? ORDER BY joined_at,user_id', domain).map(member => member.user_id),
    pendingIds: row.owner_id === user ? all<{ user_id: number }>('SELECT user_id FROM listening_domain_invites WHERE domain_id=?', domain).map(member => member.user_id) : [],
    songs: domainSongs(domain, user),
    ...readDomainMessages(domain, user),
  };
}

export function createDomain(user: number, name: string) {
  return roomTransaction(() => {
    const time = now();
    const id = Number(run('INSERT INTO listening_domains(owner_id,name,created_at) VALUES(?,?,?)', user, name, time).lastInsertRowid);
    run('INSERT INTO listening_domain_members(domain_id,user_id,joined_at) VALUES(?,?,?)', id, user, time);
    return id;
  });
}

export function inviteDomainMember(domain: number, user: number, peer: number) {
  roomTransaction(() => {
    if (requireDomain(domain, user).owner_id !== user) throw fail(403, '请由域主发出邀请');
    if (!one(`SELECT 1 FROM friendships f JOIN users u ON u.id=? AND u.status='active'
      WHERE low_id=min(?,?) AND high_id=max(?,?) AND accepted=1`, peer, user, peer, user, peer)) throw fail(403, '只能邀请好友');
    if (isMember(domain, peer)) return;
    run('INSERT OR IGNORE INTO listening_domain_invites(domain_id,user_id) VALUES(?,?)', domain, peer);
  });
}

export function answerDomainInvite(domain: number, user: number, accept: boolean) {
  roomTransaction(() => {
    if (accept && isMember(domain, user)) return;
    if (!run('DELETE FROM listening_domain_invites WHERE domain_id=? AND user_id=?', domain, user).changes) throw fail(404, '域邀请已失效');
    if (accept) run('INSERT INTO listening_domain_members(domain_id,user_id,joined_at) VALUES(?,?,?)', domain, user, now());
  });
}

export function joinDomainPlayback(listener: Listener, domain: number) {
  return roomTransaction(() => {
    requireDomain(domain, listener.userId);
    const currentRoom = liveRoom(domain);
    if (currentRoom && groupMembers(currentRoom.id).some(member => member.user_id === listener.userId && member.session_id === listener.sessionId)) return currentRoom.id;
    if (hasListeningRoom(listener.userId)) throw fail(409, '请先退出当前的同步播放');
    const time = now();
    if (currentRoom && groupMembers(currentRoom.id).length >= LISTENING_ROOM_CAPACITY) throw fail(409, '域内同步播放人数已满');
    const entries = currentRoom ? [] : domainSongs(domain, listener.userId).map(({ song }) => ({ key: randomUUID(), song }));
    const seed: SharedQueue = { entries, index: entries.length ? 0 : -1, mode: 'off' };
    const room = currentRoom?.id ?? Number(run(`INSERT INTO listening_rooms(host_id,guest_id,active,updated_at,group_room,domain_id,queue_data,song_id,transport_version)
      VALUES(?,?,1,?,1,?,?,?,1)`, listener.userId, listener.userId, time, domain, JSON.stringify(seed), entries[0]?.song.id ?? null).lastInsertRowid);
    joinGroupDevice(room, listener, time);
    return room;
  });
}

export function leaveDomain(listener: Listener, domain: number) {
  roomTransaction(() => {
    const row = requireDomain(domain, listener.userId);
    if (row.owner_id === listener.userId) throw fail(409, '域主可以退出同步播放，域会保留');
    const room = liveRoom(domain);
    const device = room && groupMembers(room.id).find(item => item.user_id === listener.userId);
    if (room && device) dropGroupDevice(room, { userId: listener.userId, sessionId: device.session_id }, now());
    run('DELETE FROM listening_domain_members WHERE domain_id=? AND user_id=?', domain, listener.userId);
  });
}

export function sendDomainMessage(domain: number, user: number, text: string, song?: Song) {
  requireDomain(domain, user);
  if (song && !publicSong(user, song.id)) throw fail(403, '域内可以分享公开上传的歌曲');
  const card: SharedSong | undefined = song && { id: song.id, name: song.name, artist: song.artists.map(artist => artist.name).join(' / '), cover: song.cover ?? null };
  run('INSERT INTO listening_domain_messages(domain_id,sender_id,text,song,sent_at) VALUES(?,?,?,?,?)',
    domain, user, text, card ? JSON.stringify(card) : null, now());
}

export function addDomainSong(domain: number, user: number, song: Song) {
  return roomTransaction(() => {
    requireDomain(domain, user);
    if (!publicSong(user, song.id)) throw fail(403, '域歌单可以添加公开上传的歌曲');
    if (song.access?.playable === false) throw fail(400, '这首歌曲暂时无法播放');
    if (one('SELECT 1 FROM listening_domain_songs WHERE domain_id=? AND song_id=?', domain, song.id)) return false;
    if (one<{ n: number }>('SELECT count(*) n FROM listening_domain_songs WHERE domain_id=?', domain)!.n >= PLAYLIST_LIMIT) throw fail(409, '域歌单最多 500 首歌曲');
    run('INSERT INTO listening_domain_songs(domain_id,song_id,song,added_by) VALUES(?,?,?,?)', domain, song.id, JSON.stringify(song), user);
    const room = liveRoom(domain);
    const queue = room && readSharedQueue(room);
    if (room && queue && queue.entries.length < PLAYLIST_LIMIT && !queue.entries.some(entry => entry.song.id === song.id)) {
      const time = now();
      const position = Math.min(86400, room.position + (room.playing ? Math.max(0, time - room.updated_at) / 1000 : 0));
      const changed = changeQueue(queue, { type: 'append', songId: song.id }, position, !!room.playing, [{ key: randomUUID(), song }]);
      run('UPDATE listening_rooms SET queue_data=?,song_id=?,position=?,playing=?,updated_at=?,transport_version=transport_version+1 WHERE id=?',
        JSON.stringify(changed.queue), changed.queue.entries[changed.queue.index]?.song.id ?? null, changed.position, Number(changed.playing), time, room.id);
    }
    return true;
  });
}

export function removeDomainSong(domain: number, user: number, song: string) {
  const { owner_id } = requireDomain(domain, user);
  if (!run('DELETE FROM listening_domain_songs WHERE domain_id=? AND song_id=? AND (added_by=? OR ?)',
    domain, song, user, Number(owner_id === user)).changes) throw fail(404, '找不到你可以移除的歌曲');
}
