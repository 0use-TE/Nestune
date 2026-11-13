import { randomUUID } from 'node:crypto';
import { changeQueue, PLAYBACK_MODES, type PlaybackMode, type QueueCommand, type SharedQueue } from '@/lib/shared-queue';
import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from './catalog';
import { db, now, one, run } from './db';
import { fail } from './http';
import { songs } from './netease';
import { uploadedSong, visibleUpload } from './uploads';
import { createPlaylist, getPlaylist } from './playlists';

type Listener = { userId: number; sessionId: string };
type Room = { id: number; host_id: number; guest_id: number; host_session_id: string; guest_session_id: string | null;
  active: number; queue_data: string | null; song_id: string | null; position: number; playing: number; updated_at: number; transport_version: number };

function participating(listener: Listener, id: number) {
  const room = one<Room>('SELECT * FROM listening_rooms WHERE id=? AND active=1 AND updated_at>=?', id, now() - 90_000);
  if (!room || !(room.host_id === listener.userId && room.host_session_id === listener.sessionId ||
    room.guest_id === listener.userId && room.guest_session_id === listener.sessionId)) throw fail(409, '请在参与一起听的设备上操作');
  return room;
}

export function readSharedQueue(room: Pick<Room, 'queue_data' | 'host_id' | 'guest_id'>): SharedQueue | null {
  if (!room.queue_data) return null;
  const queue: SharedQueue = JSON.parse(room.queue_data);
  const selected = queue.entries[queue.index]?.key;
  const entries = queue.entries.filter(({ song }) => !isUploadSong(song.id) ||
    !!visibleUpload(room.host_id, song.id) && !!visibleUpload(room.guest_id, song.id));
  return { ...queue, entries, index: entries.findIndex(entry => entry.key === selected) };
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw fail(400, '最多添加 500 首歌曲');
  return value.map(catalogId);
}
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function mode(value: unknown): PlaybackMode {
  if (!PLAYBACK_MODES.includes(value as PlaybackMode)) throw fail(400, '播放模式无效');
  return value as PlaybackMode;
}
function position(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 86400) throw fail(400, '播放位置无效');
  return value;
}

async function resolve(room: Room, viewer: number, requested: string[], strict: boolean) {
  const unique = [...new Set(requested)];
  const online = unique.filter(id => !isUploadSong(id));
  const metadata = new Map<string, Song>();
  for (let i = 0; i < online.length; i += 100) for (const song of await songs(online.slice(i, i + 100))) metadata.set(song.id, song);
  for (const id of unique.filter(isUploadSong)) {
    if (visibleUpload(room.host_id, id) && visibleUpload(room.guest_id, id)) metadata.set(id, uploadedSong(viewer, id));
    else if (strict) throw fail(403, '这首上传的歌曲需要先分享给对方');
  }
  if (strict && requested.some(id => !metadata.has(id) || metadata.get(id)?.access?.playable === false)) throw fail(400, '部分歌曲暂时无法一起播放');
  return requested.flatMap(id => {
    const song = metadata.get(id);
    return song && song.access?.playable !== false ? [{ key: randomUUID(), song }] : [];
  });
}

function atomic(work: () => void) {
  db().exec('BEGIN IMMEDIATE');
  try { work(); db().exec('COMMIT'); } catch (e) { db().exec('ROLLBACK'); throw e; }
}

/** Seed once from the queue open on the host device when the invitation is accepted. */
export async function initializeListeningQueue(listener: Listener, id: number, value: unknown) {
  const room = participating(listener, id);
  if (room.host_id !== listener.userId) throw fail(403, '由发起人初始化共同列表');
  if (room.queue_data) return;
  if (!value || typeof value !== 'object') throw fail(400, '列表格式无效');
  const seed = value as Record<string, unknown>;
  const requested = ids(seed.ids);
  if (!integer(seed.index) || typeof seed.playing !== 'boolean') throw fail(400, '播放状态无效');
  const initialPosition = position(seed.position);
  const initialMode = mode(seed.mode);
  const entries = await resolve(room, listener.userId, requested, false);
  const initialId = requested[seed.index as number];
  let index = requested.slice(0, seed.index as number).filter(id => entries.some(entry => entry.song.id === id)).length;
  if (entries[index]?.song.id !== initialId) index = 0;
  atomic(() => {
    const current = participating(listener, id);
    if (current.queue_data) return;
    const queue: SharedQueue = { entries, index: entries.length ? index : -1, mode: initialMode };
    run(`UPDATE listening_rooms SET queue_data=?,song_id=?,position=?,playing=?,updated_at=?,transport_version=transport_version+1 WHERE id=?`,
      JSON.stringify(queue), entries[index]?.song.id ?? null, entries[index]?.song.id === initialId ? initialPosition : 0,
      Number(!!entries.length && seed.playing), now(), id);
  });
}

export function saveListeningQueue(listener: Listener, id: number, name: unknown) {
  let playlist: ReturnType<typeof createPlaylist> | undefined;
  atomic(() => {
    const queue = readSharedQueue(participating(listener, id));
    if (!queue?.entries.length) throw fail(400, '共同列表还是空的');
    playlist = createPlaylist(listener.userId, name);
    for (const [index, { song }] of queue.entries.entries()) run('INSERT OR IGNORE INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(?,?,?,?)',
      playlist.id, song.id, JSON.stringify(song), now() + index);
  });
  return getPlaylist(listener.userId, playlist!.id).playlist;
}

export async function editListeningQueue(listener: Listener, id: number, value: unknown) {
  const room = participating(listener, id);
  if (!room.queue_data) throw fail(409, '共同列表正在准备中');
  if (!value || typeof value !== 'object') throw fail(400, '列表操作无效');
  const raw = value as Record<string, unknown>;
  let command: QueueCommand;
  let requested: string[] = [];
  switch (raw.type) {
    case 'append': case 'insertNext': case 'playNow': requested = [catalogId(raw.songId)]; command = { type: raw.type, songId: requested[0] }; break;
    case 'replace':
      requested = ids(raw.songIds);
      if (!integer(raw.index)) throw fail(400, '歌曲位置无效');
      command = { type: 'replace', songIds: requested, index: raw.index as number, mode: raw.mode === undefined ? undefined : mode(raw.mode) }; break;
    case 'remove': case 'jump':
      if (typeof raw.key !== 'string' || raw.key.length > 64) throw fail(400, '歌曲位置无效');
      command = { type: raw.type, key: raw.key }; break;
    case 'clear': case 'prev': case 'mode': command = { type: raw.type }; break;
    case 'next':
      if (raw.automatic !== undefined && typeof raw.automatic !== 'boolean' || raw.version !== undefined && !integer(raw.version)) throw fail(400, '播放状态无效');
      command = { type: 'next', automatic: raw.automatic as boolean | undefined, version: raw.version as number | undefined }; break;
    case 'seek': command = { type: 'seek', position: position(raw.position) }; break;
    default: throw fail(400, '未知列表操作');
  }
  const additions = await resolve(room, listener.userId, requested, true);
  atomic(() => {
    const current = participating(listener, id);
    if (additions.some(({ song }) => isUploadSong(song.id) && (!visibleUpload(current.host_id, song.id) || !visibleUpload(current.guest_id, song.id)))) throw fail(403, '歌曲的分享权限已改变');
    if (command.type === 'next' && command.automatic &&
      (current.host_id !== listener.userId || current.transport_version !== command.version)) return;
    const queue = readSharedQueue(current)!;
    if ((command.type === 'append' || command.type === 'insertNext' || command.type === 'playNow' && !queue.entries.some(entry => entry.song.id === command.songId)) && queue.entries.length + additions.length > 500) throw fail(400, '共同列表最多 500 首歌曲');
    const elapsed = current.playing ? Math.max(0, now() - current.updated_at) / 1000 : 0;
    let changed;
    try { changed = changeQueue(queue, command, Math.min(86400, current.position + elapsed), !!current.playing, additions); }
    catch (e) { throw fail(409, e instanceof Error ? e.message : '列表已更新'); }
    run(`UPDATE listening_rooms SET queue_data=?,song_id=?,position=?,playing=?,updated_at=?,transport_version=transport_version+1 WHERE id=?`,
      JSON.stringify(changed.queue), changed.queue.entries[changed.queue.index]?.song.id ?? null,
      changed.position, Number(changed.playing), now(), id);
  });
}
