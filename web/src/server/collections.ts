import { COLLECTION_KINDS, type CollectionFavorite, type CollectionKind } from '@/lib/collection-types';
import { all, now, one, run } from './db';
import { fail, numericId } from './http';
import { collectionMetadata } from './netease';
import { sharedPlaylistSummary } from './playlists';

export function collectionTarget(kind: unknown, value: unknown) {
  if (!COLLECTION_KINDS.includes(kind as CollectionKind)) throw fail(400, '收藏类型无效');
  const id = numericId(value).replace(/^0+(?=\d)/, '');
  if (id === '0' || kind === 'shared' && !Number.isSafeInteger(Number(id))) throw fail(400, '收藏 ID 无效');
  return { kind: kind as CollectionKind, id };
}
export function isCollected(user: number, kind: CollectionKind, id: string) {
  return !!one('SELECT 1 FROM collection_favorites WHERE user_id=? AND kind=? AND target_id=?', user, kind, id);
}
export async function collect(user: number, kind: CollectionKind, id: string) {
  if (isCollected(user, kind, id)) return;
  if (one<{ n: number }>('SELECT count(*) n FROM collection_favorites WHERE user_id=?', user)!.n >= 500) throw fail(400, '最多收藏 500 个专辑和歌单');
  let meta: { name: string; cover: string | null; sub: string };
  if (kind === 'shared') {
    const item = sharedPlaylistSummary(user, Number(id));
    meta = { name: item.name, cover: item.cover, sub: `${item.trackCount} 首` };
  } else meta = await collectionMetadata(kind, id);
  run('INSERT OR IGNORE INTO collection_favorites(user_id,kind,target_id,meta,created_at) VALUES(?,?,?,?,?)', user, kind, id, JSON.stringify(meta), now());
}
export function uncollect(user: number, kind: CollectionKind, id: string) {
  run('DELETE FROM collection_favorites WHERE user_id=? AND kind=? AND target_id=?', user, kind, id);
}
export function collected(user: number): CollectionFavorite[] {
  return all<{ kind: CollectionKind; target_id: string; meta: string; created_at: number }>('SELECT * FROM collection_favorites WHERE user_id=? ORDER BY created_at DESC,rowid DESC', user).map(row => {
    let meta = JSON.parse(row.meta), available = true;
    if (row.kind === 'shared') {
      try { const item = sharedPlaylistSummary(user, Number(row.target_id)); meta = { name: item.name, cover: item.cover, sub: `${item.trackCount} 首` }; }
      catch { meta = { name: '歌单已不可用', cover: null, sub: '' }; available = false; }
    }
    return { ...meta, kind: row.kind, id: row.target_id, savedAt: row.created_at, available };
  });
}
