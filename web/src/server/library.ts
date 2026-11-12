import fs from 'node:fs';
import { dir } from './config';
import { all, one, run } from './db';
import { fail } from './http';
import type { UserRow } from './auth';

type Row = { song_id: string; meta: string; ext: string; size: number; level: string; saved_by: number; created_at: number; file: string };
const shape = (r: Row) => ({ ...JSON.parse(r.meta), savedAt: r.created_at, size: r.size, level: r.level, ext: r.ext, savedBy: r.saved_by });

export const listLibrary = () => all<Row>('SELECT * FROM library ORDER BY created_at DESC').map(shape);
export const inLibrary = (id: string) => !!one('SELECT 1 x FROM library WHERE song_id=?', id);

export function removeFromLibrary(id: string, user?: UserRow) {
  const r = one<Row>('SELECT * FROM library WHERE song_id=?', id);
  if (!r) throw fail(404, '本地库中没有这首歌');
  if (user && r.saved_by !== user.id) throw fail(403, '只能移除自己保存的歌曲');
  fs.rmSync(dir('library', r.file), { force: true });
  run('DELETE FROM library WHERE song_id=?', id);
}
