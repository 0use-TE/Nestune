import type { PlaylistFolder } from '@/lib/playlist-folders';
import type { Song } from '@/lib/types';
import { all, one } from './db';
import { uniqueRecordings } from './recordings';
import { visibleSong } from './uploads';

export type FolderRow = { id: number; playlist_id: number; kind: PlaylistFolder['kind']; target_id: string; meta: string; added_at: number };
export function canReadPlaylist(viewer: number, id: number) {
  return one<{ user_id: number; name: string }>(`SELECT p.user_id,p.name FROM playlists p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND u.status='active' AND (p.user_id=? OR (p.is_public=1 AND u.profile_public=1))`, id, viewer);
}
export function playlistContent(viewer: number, id: number, ancestors: number[] = []): { songs: Song[]; directSongs: Song[]; folders: PlaylistFolder[] } {
  if (ancestors.includes(id) || ancestors.length >= 16 || !canReadPlaylist(viewer, id)) return { songs: [], directSongs: [], folders: [] };
  const path = [...ancestors, id];
  const direct = all<{ meta: string; added_at: number; rowid: number }>('SELECT meta,added_at,rowid FROM playlist_songs WHERE playlist_id=? ORDER BY added_at,rowid', id)
    .flatMap(row => { const song = visibleSong(viewer, JSON.parse(row.meta)); return song ? [{ song: { ...song, addedAt: row.added_at }, at: row.added_at, order: row.rowid }] : []; });
  const entries: { songs: Song[]; at: number; order: number }[] = direct.map(row => ({ songs: [row.song], at: row.at, order: row.order }));
  const folders = all<FolderRow>('SELECT * FROM playlist_folders WHERE playlist_id=? ORDER BY added_at,id', id).map(row => {
    const meta = JSON.parse(row.meta);
    let available = true, readonly = true, songs: Song[] = [], directSongs: Song[] = [], children: PlaylistFolder[] = [], name = meta.name;
    if (row.kind === 'mine' || row.kind === 'shared') {
      const target = canReadPlaylist(viewer, Number(row.target_id));
      readonly = target?.user_id !== viewer;
      available = !!target && !path.includes(Number(row.target_id)) && path.length < 16;
      if (available) { const data = playlistContent(viewer, Number(row.target_id), path); songs = data.songs; directSongs = data.directSongs; children = data.folders; name = target!.name; }
    } else directSongs = songs = (meta.songs ?? []).flatMap((song: Song) => { const visible = visibleSong(viewer, song); return visible ? [visible] : []; });
    entries.push({ songs, at: row.added_at, order: row.id });
    return { id: row.id, kind: row.kind, targetId: row.target_id, name, cover: songs[0]?.cover ?? meta.cover ?? null, readonly, available, songs, directSongs, folders: children };
  });
  const songs = uniqueRecordings(entries.sort((a, b) => a.at - b.at || a.order - b.order).flatMap(entry => entry.songs));
  // A referenced playlist can grow after it was embedded. Keep it readable and
  // removable; capacity checks belong to additions, never to reading a library.
  return { songs, directSongs: direct.map(row => row.song), folders };
}

export function wouldCycle(parent: number, child: number, path = new Set<number>()): boolean {
  if (parent === child || path.has(child)) return true;
  if (path.size >= 16) return true;
  const next = new Set(path); next.add(child);
  return all<{ target_id: string }>("SELECT target_id FROM playlist_folders WHERE playlist_id=? AND kind IN ('mine','shared')", child)
    .some(row => wouldCycle(parent, Number(row.target_id), next));
}
