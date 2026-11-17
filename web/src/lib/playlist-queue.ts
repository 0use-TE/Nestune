import { get } from './api';
import type { Song } from './types';

export function personalPlaylistPath(id: string): string {
  if (id === 'favorites') return '/api/me/favorites';
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) throw Error('歌单无效');
  return `/api/me/playlists/${id}`;
}

/** Read through the owner's endpoint so private playlists remain usable in their own queue. */
export async function personalPlaylistSongs(id: string): Promise<Song[]> {
  const result = await get<{ songs: Song[] }>(personalPlaylistPath(id));
  if (!Array.isArray(result.songs) || !result.songs.length) throw Error('这个歌单还是空的');
  return result.songs;
}
