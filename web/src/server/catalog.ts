import { isUploadSong } from '@/lib/upload-types';
import type { Song } from '@/lib/types';
import { isQqId, sameRecording } from '@/lib/music-ids';
import { rankSearchSongs } from '@/lib/search-ranking';
import { numericId, fail } from './http';
import * as netease from './netease';
import { qqConfigured, qqSongMeta, qqSearch, qqAlbum, qqArtist, qqArtistSongs } from './qqmusic';
import { cachedOnlineSong, enrichSong, markMatched, matchingDue, mergedSongs, rememberSongs } from './recordings';
import { uploadedSong } from './uploads';

export const catalogId = (id: unknown) => isUploadSong(id) || isQqId(id) ? id : numericId(id);
export async function onlineSongs(ids: string[]): Promise<Song[]> {
  const unique = [...new Set(ids)].slice(0, 100), ne = unique.filter(id => !isQqId(id));
  const [ns, qs] = await Promise.all([Promise.allSettled([ne.length ? netease.songs(ne) : Promise.resolve([])]), Promise.allSettled(unique.filter(isQqId).map(qqSongMeta))]);
  const list: Song[] = [...(ns[0].status === 'fulfilled' ? ns[0].value : []), ...qs.flatMap(x => x.status === 'fulfilled' ? [x.value] : [])];
  rememberSongs(list);
  const byId = new Map(list.map(s => [s.id, enrichSong(s)]));
  for (const id of unique) if (!byId.has(id)) { const cached = cachedOnlineSong(id); if (cached) byId.set(id, enrichSong(cached)); }
  return unique.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}
export async function onlineSong(id: string): Promise<Song> {
  const song = isQqId(id) ? await qqSongMeta(id) : await netease.songMeta(id);
  rememberSongs([song]);
  return enrichSong(song);
}
const discoveries = new Map<string, Promise<Song>>();
export async function discoverSources(id: string): Promise<Song> {
  if (discoveries.has(id)) return discoveries.get(id)!;
  const task = (async () => {
    const song = await onlineSong(id).catch(e => { const cached = cachedOnlineSong(id); if (!cached) throw e; return enrichSong(cached); });
    if (!qqConfigured() || !matchingDue(id)) return song;
    try {
      const query = `${song.name} ${song.artists.map(a => a.name).join(' ')}`.slice(0, 100);
      const other = isQqId(id) ? await netease.search(query, 'song', 20, 0) : await qqSearch(query, 20, 0);
      const matches = (other.items as Song[]).filter(s => sameRecording(song, s));
      // Multiple plausible releases are ambiguous, even if all are from one platform.
      if (matches.length === 1) rememberSongs([song, matches[0]]);
      markMatched(id);
    } catch { /* An unavailable source must not prevent playback on the other. */ }
    return enrichSong(song);
  })().finally(() => discoveries.delete(id));
  discoveries.set(id, task); return task;
}
export const catalogSong = (viewer: number, id: string) => isUploadSong(id) ? uploadedSong(viewer, id) : onlineSong(id);
export async function searchSongs(query: string, limit: number, offset: number, uploads: Song[] = []) {
  const enabled = qqConfigured();
  const [ne, qq] = await Promise.allSettled([netease.search(query, 'song', limit, offset), enabled ? qqSearch(query, limit, offset) : Promise.resolve({ items: [], total: 0 })]);
  const results = [ne, qq].flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (ne.status === 'rejected' && (!enabled || qq.status === 'rejected')) throw fail(502, '音乐搜索暂时不可用，请稍后重试');
  const songs = results.flatMap(r => r.items) as Song[]; rememberSongs(songs);
  return { type: 'song', items: rankSearchSongs(query, [...mergedSongs(songs), ...uploads], results.map(r => r.items as Song[]), offset), total: results.reduce((n, r) => n + r.total, 0),
    nextOffset: offset + limit, hasMore: results.some(r => offset + limit < r.total),
    warnings: [ne.status === 'rejected' ? '网易云暂时无法连接，已显示其他来源' : '', enabled && qq.status === 'rejected' ? 'QQ 音乐暂时无法连接，已显示其他来源' : ''].filter(Boolean) };
}
export async function catalogAlbum(id: string) {
  const result = isQqId(id) ? await qqAlbum(id) : await netease.album(id);
  rememberSongs(result.songs); return { ...result, songs: result.songs.map(enrichSong) };
}
export async function catalogArtist(id: string) {
  const result = isQqId(id) ? await qqArtist(id) : await netease.artist(id);
  rememberSongs(result.songs); return { ...result, songs: result.songs.map(enrichSong) };
}
export async function catalogArtistSongs(id: string, limit: number, offset: number) {
  const result = isQqId(id) ? await qqArtistSongs(id, limit, offset) : await netease.artistSongs(id, limit, offset);
  rememberSongs(result.songs); return { ...result, songs: result.songs.map(enrichSong) };
}
export async function catalogCollectionMetadata(kind: 'album' | 'playlist', id: string) {
  if (!isQqId(id)) return netease.collectionMetadata(kind, id);
  if (kind !== 'album') throw fail(400, '暂不支持 QQ 平台歌单收藏');
  const { album } = await qqAlbum(id); return { name: album.name, cover: album.cover, sub: album.artist };
}
