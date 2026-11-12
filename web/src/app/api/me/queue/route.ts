import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { one, run } from '@/server/db';
import { body, fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { songs } from '@/server/netease';
import { visibleSong } from '@/server/uploads';

type Saved = { ids: string[]; index: number; position: number };

export const GET = userRoute(async (_req, _ctx, u) => {
  const row = one<{ data: string }>('SELECT data FROM queue WHERE user_id=?', u.id);
  const q: Saved = row ? JSON.parse(row.data) : { ids: [], index: 0, position: 0 };
  const onlineIds = q.ids.filter(id => !isUploadSong(id));
  const online: Song[] = [];
  for (let offset = 0; offset < onlineIds.length; offset += 100) online.push(...await songs(onlineIds.slice(offset, offset + 100)));
  const byId = new Map<string, Song>(online.map(song => [song.id, song]));
  const slots = q.ids.map(id => isUploadSong(id) ? visibleSong(u.id, { id } as Song) : byId.get(id));
  const index = slots.slice(0, q.index).filter(Boolean).length;
  return { songs: slots.filter(Boolean), index, position: slots[q.index] ? q.position : 0 };
});

export const PUT = userRoute(async (req, _ctx, u) => {
  const b = await body<Saved>(req, 65536);
  if (!Array.isArray(b.ids) || b.ids.length > 500) throw fail(400, '队列格式无效');
  const q: Saved = { ids: b.ids.map(catalogId), index: Math.max(0, Math.min(Number(b.index) || 0, b.ids.length)), position: Math.max(0, Number(b.position) || 0) };
  run('INSERT INTO queue(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data', u.id, JSON.stringify(q));
  return { ok: true };
});
