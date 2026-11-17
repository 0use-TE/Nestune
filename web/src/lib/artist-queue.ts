import type { Song } from './types';
export type ArtistSongsPage = { songs: Song[]; more: boolean; total: number | null };
export async function loadArtistQueue(load: (offset: number, limit: number) => Promise<ArtistSongsPage>,
  signal: AbortSignal, progress: (count: number) => void = () => {}) {
  const songs: Song[] = [], ids = new Set<string>();
  let offset = 0, more = true;
  while (more && songs.length < 500) {
    signal.throwIfAborted();
    const page = await load(offset, Math.min(100, 500 - songs.length));
    signal.throwIfAborted();
    if (!Array.isArray(page.songs)) throw Error('歌手歌曲列表无效，请重试');
    let added = 0;
    for (const song of page.songs) if (!ids.has(song.id)) { ids.add(song.id); songs.push(song); added++; }
    more = !!page.more;
    if (more && !added) throw Error('歌手歌曲列表未能继续加载，请重试');
    offset += page.songs.length;
    progress(songs.length);
  }
  return { songs: songs.slice(0, 500).filter(song => song.access?.playable !== false), limited: more };
}
