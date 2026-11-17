import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { CanvasBase, CanvasItem, CanvasRecord, CanvasState } from '@/lib/canvas-types';
import { isCanvasMusic } from '@/lib/canvas-types';
import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { db, kvGet, kvSet, one, all } from './db';
import { catalogId, catalogSong } from './catalog';
import { catalogAlbum as album, onlineSongs as lookupSongs } from './catalog';
import { getPlaylist } from './playlists';
import { visibleSong } from './uploads';
import { enrichSong } from './recordings';
import { dir } from './config';
import { sniffImage, avatarMime } from './avatar';
import { fail, str } from './http';

const storageKey = () => 'canvas:shared:v1';
const publicSong = (song: Song) => !isUploadSong(song.id) || !!one("SELECT 1 FROM uploaded_songs s JOIN users u ON u.id=s.owner_id WHERE s.id=? AND s.visibility='public' AND u.status='active'", song.id);
function poster(ownerId: number) {
  const user = one<{ name: string; avatar: string }>("SELECT COALESCE(NULLIF(display_name,''),username) name,avatar FROM users WHERE id=?", ownerId);
  return { ownerName: user?.name || `用户 ${ownerId}`, ownerAvatar: user?.avatar ? `/api/avatars/${user.avatar}` : null };
}
export function readCanvas(): CanvasState {
  const raw = kvGet(storageKey());
  const state: CanvasState = raw ? JSON.parse(raw) : { revision: 0, records: [] };
  state.records = state.records.flatMap<CanvasItem>(item => {
    if (isCanvasMusic(item)) {
      if (!publicSong(item.song)) return [];
      const tracks = (item.tracks ?? [item.song]).filter(publicSong);
      if (!tracks.length) return [];
      return [{ ...item, song: enrichSong(item.song), tracks: tracks.map(enrichSong), ...poster(item.ownerId) }];
    }
    return [{ ...item, ...poster(item.ownerId) }];
  });
  return state;
}
function mutate(change: (state: CanvasState) => void) {
  const database = db(); database.exec('BEGIN IMMEDIATE');
  try {
    const state = readCanvas(); change(state); state.revision++;
    kvSet(storageKey(), JSON.stringify(state)); database.exec('COMMIT'); return state;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
function coordinate(value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw fail(400, '物件位置无效');
  return value;
}
function base(ownerId: number, input: Record<string, unknown>): CanvasBase {
  return { id: randomUUID(), ownerId, ...poster(ownerId), x: coordinate(input.x, 1000), y: coordinate(input.y, 650), rotation: Math.random() * 18 - 9, name: '' };
}
function store(item: CanvasItem) {
  return mutate(state => {
    if (state.records.length >= 200) throw fail(400, '画布已满');
    if (state.records.filter(r => r.ownerId === item.ownerId).length >= 30) throw fail(400, '每人最多放置 30 个物件');
    state.records.push(item);
  });
}
function shareable(tracks: Song[]) {
  if (!tracks.length) throw fail(400, '这里还没有歌曲');
  if (tracks.length > 500) throw fail(400, '一叠唱片最多包含 500 首歌');
  if (tracks.some(song => !publicSong(song))) throw fail(400, '请先将歌单中的私密上传设为公开');
  return tracks;
}
export async function resolveCanvasMusic(ownerId: number, input: Record<string, unknown>) {
  const kind = ['album', 'playlist', 'queue'].includes(String(input.kind)) ? input.kind as CanvasRecord['kind'] : 'song';
  let tracks: Song[] = [], name = '', albumId: string | null = null;
  if (kind === 'playlist') {
    if (input.playlistId === 'favorites') {
      name = '我喜欢的音乐';
      tracks = all<{ meta: string }>('SELECT meta FROM favorites WHERE user_id=? ORDER BY created_at DESC', ownerId).flatMap(row => { const song = visibleSong(ownerId, JSON.parse(row.meta)); return song ? [song] : []; });
    } else {
      const target = Number(catalogId(input.playlistId));
      if (!Number.isSafeInteger(target)) throw fail(400, '歌单无效');
      const data = getPlaylist(ownerId, target); name = data.playlist.name; tracks = data.songs;
    }
  } else if (kind === 'queue') {
    const ids = queueIds(input.songIds), online = ids.filter(id => !isUploadSong(id));
    const found: Song[] = [];
    for (let offset = 0; offset < online.length; offset += 100) found.push(...await lookupSongs(online.slice(offset, offset + 100)));
    const byId = new Map(found.map(song => [song.id, song]));
    for (const id of ids) {
      const song = isUploadSong(id) ? await catalogSong(ownerId, id) : byId.get(id);
      if (!song) throw fail(404, '播放队列包含不可分享的歌曲');
      tracks.push(song);
    }
    name = '播放列表';
  } else if (kind === 'album') {
    albumId = input.albumId ? catalogId(input.albumId) : (await catalogSong(ownerId, catalogId(input.songId))).album.id;
    if (!albumId || isUploadSong(albumId)) throw fail(400, '这个专辑暂时无法分享');
    const data = await album(albumId); tracks = data.songs; name = data.album.name;
  } else {
    const id = catalogId(input.songId);
    if (isUploadSong(id) && !publicSong({ id } as Song)) throw fail(400, '请先将这首上传歌曲设为公开');
    tracks = [await catalogSong(ownerId, id)]; name = tracks[0].name;
  }
  shareable(tracks);
  return { kind, tracks, song: tracks[0], name, albumId };
}
function queueIds(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw fail(400, '播放队列需要 1 到 500 首歌曲');
  return value.map(catalogId);
}
export async function addRecord(ownerId: number, input: Record<string, unknown>) {
  const position = base(ownerId, input);
  const music = await resolveCanvasMusic(ownerId, input);
  return store({ ...position, ...music });
}
export function addCanvasTool(ownerId: number, input: Record<string, unknown>) {
  const position = base(ownerId, input);
  if (input.kind === 'note') {
    const text = str(input.text, 1, 800, '便签');
    const color = ['butter', 'rose', 'mint'].includes(String(input.color)) ? input.color as 'butter' | 'rose' | 'mint' : 'paper';
    return store({ ...position, kind: 'note', name: '便签', text, color });
  }
  if (input.kind === 'emoji') {
    const emoji = str(input.emoji, 1, 32, '表情');
    if (!/\p{Extended_Pictographic}/u.test(emoji)) throw fail(400, '请选择一个表情');
    return store({ ...position, kind: 'emoji', name: '表情', emoji });
  }
  throw fail(400, '小工具无效');
}
export function moveRecord(_viewer: number, input: Record<string, unknown>) {
  const x = coordinate(input.x, 1000), y = coordinate(input.y, 650);
  return mutate(state => {
    const item = state.records.find(r => r.id === input.id);
    if (!item) throw fail(409, '这个物件已经被拿走了');
    item.x = x; item.y = y;
    // The shared array is painted back to front; a completed move remains on top.
    state.records = [...state.records.filter(r => r.id !== item.id), item];
  });
}
export async function takeCanvasItem(viewer: number, id: unknown, accept?: (item: CanvasItem) => void) {
  // Resolve legacy albums before claiming; the transaction below still selects exactly one taker.
  const existing = readCanvas().records.find(item => item.id === id);
  if (!existing) throw fail(409, '这个物件已经被别人拿走了');
  if (isCanvasMusic(existing) && (existing.tracks ?? [existing.song]).every(song => song.access?.playable === false)) throw fail(400, '这些歌曲暂时无法播放');
  let music: Awaited<ReturnType<typeof resolveCanvasMusic>> | undefined;
  if (isCanvasMusic(existing) && existing.kind === 'album' && existing.albumId && existing.tracks?.length === 1) {
    music = await resolveCanvasMusic(viewer, { kind: 'album', albumId: existing.albumId });
  }
  let taken!: CanvasItem;
  const state = mutate(board => {
    const item = board.records.find(r => r.id === id);
    if (!item) throw fail(409, '这个物件已经被别人拿走了');
    taken = music ? { ...item, ...music } as CanvasRecord : item;
    // Consumers can validate and update a shared queue in this same transaction.
    accept?.(taken);
    board.records = board.records.filter(r => r.id !== id);
  });
  discardImage(taken);
  return { state, item: taken };
}
export function removeRecord(_viewer: number, recordId: unknown) {
  let taken!: CanvasItem;
  const state = mutate(state => {
    const found = state.records.find(r => r.id === recordId);
    if (!found) throw fail(409, '这个物件已经被拿走了');
    taken = found;
    state.records = state.records.filter(r => r.id !== recordId);
  });
  discardImage(taken); return state;
}
export const CANVAS_IMAGE_MAX = 3 * 1024 * 1024;
const imagePattern = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
function discardImage(item: CanvasItem) {
  if (item.kind === 'image' && imagePattern.test(item.imageFile)) {
    try { fs.rmSync(dir('canvas-images', item.imageFile), { force: true }); } catch { /* Unreferenced files cannot be served. */ }
  }
}
export function addCanvasImage(owner: number, bytes: Buffer, input: Record<string, unknown>) {
  if (!bytes.length || bytes.length > CANVAS_IMAGE_MAX) throw fail(413, '图片不能超过 3 MB');
  const ext = sniffImage(bytes) ?? (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ? 'gif' : null);
  if (!ext) throw fail(400, '支持 PNG、JPG、WebP 或 GIF 图片');
  const item = { ...base(owner, input), kind: 'image' as const, name: '图片', imageFile: `${randomUUID()}.${ext}` };
  fs.mkdirSync(dir('canvas-images'), { recursive: true });
  fs.writeFileSync(dir('canvas-images', item.imageFile), bytes, { mode: 0o600 });
  try { return store(item); } catch (error) { fs.rmSync(dir('canvas-images', item.imageFile), { force: true }); throw error; }
}
export function canvasImage(name: string) {
  if (!imagePattern.test(name) || !readCanvas().records.some(item => item.kind === 'image' && item.imageFile === name)) throw fail(404, '图片已被取走');
  const file = dir('canvas-images', name);
  if (!fs.existsSync(file)) throw fail(404, '图片不存在');
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { 'Content-Type': name.endsWith('.gif') ? 'image/gif' : avatarMime(name), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
