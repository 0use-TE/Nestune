import { all, now, one, run } from './db';
import { fail } from './http';
import { catalogSong } from './catalog';
import { visibleSong } from './uploads';

type PRow = { id: number; user_id: number; name: string; description: string; created_at: number; updated_at: number; is_public: number };
const MAX_PLAYLISTS = 100, MAX_SONGS = 1000;

function owned(userId: number, id: number) {
  const p = one<PRow>('SELECT * FROM playlists WHERE id=?', id);
  if (!p || p.user_id !== userId) throw fail(404, '歌单不存在');
  return p;
}
const shape = (p: PRow, viewer = p.user_id) => {
  const songs = all<{ meta: string }>('SELECT meta FROM playlist_songs WHERE playlist_id=? ORDER BY added_at DESC', p.id)
    .map(row => visibleSong(viewer, JSON.parse(row.meta))).filter(Boolean);
  return {
    id: p.id, name: p.name, description: p.description, createdAt: p.created_at, updatedAt: p.updated_at,
    trackCount: songs.length,
    cover: songs[0]?.cover ?? null, isPublic: !!p.is_public,
  };
};
const cleanName = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 40) throw fail(400, '歌单名称需要在 1 到 40 个字之间');
  return s;
};

export const listPlaylists = (userId: number) =>
  all<PRow>('SELECT * FROM playlists WHERE user_id=? ORDER BY updated_at DESC', userId).map(p => shape(p));

export function createPlaylist(userId: number, name: unknown, description?: unknown) {
  if (one<{ n: number }>('SELECT COUNT(*) n FROM playlists WHERE user_id=?', userId)!.n >= MAX_PLAYLISTS) throw fail(400, `最多创建 ${MAX_PLAYLISTS} 个歌单`);
  const desc = String(description ?? '').trim().slice(0, 200);
  const r = run('INSERT INTO playlists(user_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)', userId, cleanName(name), desc, now(), now());
  return shape(one<PRow>('SELECT * FROM playlists WHERE id=?', Number(r.lastInsertRowid))!);
}

export function getPlaylist(userId: number, id: number) {
  const p = owned(userId, id);
  const songs = all<{ meta: string; added_at: number }>('SELECT meta,added_at FROM playlist_songs WHERE playlist_id=? ORDER BY added_at ASC', id)
    .flatMap(r => {
      const song = visibleSong(userId, JSON.parse(r.meta));
      return song ? [{ ...song, addedAt: r.added_at }] : [];
    });
  return { playlist: shape(p), songs };
}

export function updatePlaylist(userId: number, id: number, patch: { name?: unknown; description?: unknown; isPublic?: unknown }) {
  const p = owned(userId, id);
  if (patch.isPublic !== undefined) {
    if (typeof patch.isPublic !== 'boolean') throw fail(400, '公开设置无效');
    run('UPDATE playlists SET is_public=? WHERE id=?', Number(patch.isPublic), id);
  }
  if (patch.name !== undefined) run('UPDATE playlists SET name=? WHERE id=?', cleanName(patch.name), id);
  if (patch.description !== undefined) run('UPDATE playlists SET description=? WHERE id=?', String(patch.description).trim().slice(0, 200), id);
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), p.id);
  return shape(one<PRow>('SELECT * FROM playlists WHERE id=?', id)!);
}

export function personProfile(viewer: number, id: number) {
  const person = one<{ id: number; username: string; display_name: string; avatar: string; bio: string; profile_public: number }>("SELECT id,username,display_name,avatar,bio,profile_public FROM users WHERE id=? AND status='active'", id);
  if (!person || viewer !== id && !person.profile_public) throw fail(404, '此用户未公开个人主页');
  return {
    person: { id, username: person.username, name: person.display_name || person.username, avatar: person.avatar ? `/api/avatars/${person.avatar}` : null, bio: person.bio },
    playlists: all<PRow>('SELECT * FROM playlists WHERE user_id=? AND is_public=1 ORDER BY updated_at DESC', id).map(p => shape(p, viewer)),
  };
}

export function sharedPlaylistSummary(viewer: number, id: number) {
  const p = one<PRow>(`SELECT p.* FROM playlists p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.is_public=1 AND u.status='active' AND (u.profile_public=1 OR u.id=?)`, id, viewer);
  if (!p) throw fail(404, '歌单未公开或已删除');
  return shape(p, viewer);
}

export function sharedPlaylist(viewer: number, id: number) {
  const p = one<PRow>('SELECT * FROM playlists WHERE id=?', id);
  if (!p || !p.is_public) throw fail(404, '歌单未公开或已删除');
  const { person } = personProfile(viewer, p.user_id);
  const songs = all<{ meta: string }>('SELECT meta FROM playlist_songs WHERE playlist_id=? ORDER BY added_at ASC', id)
    .flatMap(row => { const song = visibleSong(viewer, JSON.parse(row.meta)); return song ? [song] : []; });
  return { playlist: shape(p, viewer), songs, owner: person };
}

export function deletePlaylist(userId: number, id: number) {
  owned(userId, id);
  run('DELETE FROM playlists WHERE id=?', id);
}

export async function addSong(userId: number, id: number, songId: string) {
  owned(userId, id);
  if (one<{ n: number }>('SELECT COUNT(*) n FROM playlist_songs WHERE playlist_id=?', id)!.n >= MAX_SONGS) throw fail(400, `每个歌单最多 ${MAX_SONGS} 首`);
  if (one('SELECT 1 x FROM playlist_songs WHERE playlist_id=? AND song_id=?', id, songId)) return { added: false };
  const meta = await catalogSong(userId, songId);
  run('INSERT OR IGNORE INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(?,?,?,?)', id, songId, JSON.stringify(meta), now());
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), id);
  return { added: true };
}

export function removeSong(userId: number, id: number, songId: string) {
  owned(userId, id);
  run('DELETE FROM playlist_songs WHERE playlist_id=? AND song_id=?', id, songId);
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), id);
}
