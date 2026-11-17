import type { FolderSource } from '@/lib/playlist-folders';
import { all, db, now, one, run } from './db';
import { fail } from './http';
import { catalogAlbum, catalogId } from './catalog';
import { canReadPlaylist, playlistContent, wouldCycle } from './playlist-content';
import { externalPlaylist } from './playlist-import';

function owner(user: number, id: number) {
  if (!one('SELECT 1 FROM playlists WHERE id=? AND user_id=?', id, user)) throw fail(404, '歌单不存在或你没有编辑权限');
}
export async function addFolder(user: number, parent: number, source: FolderSource) {
  owner(user, parent);
  if (!source || !['album','mine','shared','netease','qq'].includes(source.kind) || typeof source.id !== 'string') throw fail(400, '请选择专辑或歌单');
  let data: { name: string; cover: string | null; songs?: unknown };
  if (source.kind === 'album') {
    const result = await catalogAlbum(catalogId(source.id));
    data = { name: result.album.name, cover: result.album.cover, songs: result.songs };
  } else if (source.kind === 'mine' || source.kind === 'shared') {
    if (!/^[1-9]\d{0,11}$/.test(source.id)) throw fail(400, '歌单编号无效');
    const item = canReadPlaylist(user, Number(source.id));
    if (!item || source.kind === 'mine' && item.user_id !== user) throw fail(404, '歌单未公开或已删除');
    data = { name: item.name, cover: playlistContent(user, Number(source.id)).songs[0]?.cover ?? null };
  } else data = await externalPlaylist({ provider: source.kind, id: source.id });
  const connection = db(); connection.exec('BEGIN IMMEDIATE');
  try {
    owner(user, parent);
    if (['mine','shared'].includes(source.kind) && (!canReadPlaylist(user, Number(source.id)) || wouldCycle(parent, Number(source.id)))) throw fail(400, '不能把歌单放入自身或形成循环，嵌套最多 16 层');
    if (all('SELECT id FROM playlist_folders WHERE playlist_id=?', parent).length >= 100) throw fail(400, '每个歌单最多放 100 个文件夹');
    run('INSERT OR IGNORE INTO playlist_folders(playlist_id,kind,target_id,meta,added_at) VALUES(?,?,?,?,?)', parent, source.kind, source.id, JSON.stringify(data), now());
    const content = playlistContent(user, parent);
    if (content.songs.length > 1000) throw fail(400, '组合后的歌单最多 1000 首，请拆分后再添加');
    run('UPDATE playlists SET updated_at=? WHERE id=?', now(), parent);
    connection.exec('COMMIT'); return content;
  } catch (error) { connection.exec('ROLLBACK'); throw error; }
}
export function removeFolder(user: number, parent: number, folder: number) {
  owner(user, parent); run('DELETE FROM playlist_folders WHERE playlist_id=? AND id=?', parent, folder);
  run('UPDATE playlists SET updated_at=? WHERE id=?', now(), parent); return playlistContent(user, parent);
}
