import { one, run } from '@/server/db';
import { body, fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { songs } from '@/server/netease';

type Saved = { ids: string[]; index: number; position: number };

export const GET = userRoute(async (_req, _ctx, u) => {
  const row = one<{ data: string }>('SELECT data FROM queue WHERE user_id=?', u.id);
  const q: Saved = row ? JSON.parse(row.data) : { ids: [], index: 0, position: 0 };
  const list = q.ids.length ? await songs(q.ids) : [];
  const byId = new Map(list.map(s => [s.id, s]));
  return { songs: q.ids.map(i => byId.get(i)).filter(Boolean), index: q.index, position: q.position };
});

export const PUT = userRoute(async (req, _ctx, u) => {
  const b = await body<Saved>(req, 65536);
  if (!Array.isArray(b.ids) || b.ids.length > 500 || b.ids.some(i => !/^\d{1,20}$/.test(String(i)))) throw fail(400, '队列格式无效');
  const q: Saved = { ids: b.ids.map(String), index: Math.max(0, Math.min(Number(b.index) || 0, b.ids.length)), position: Math.max(0, Number(b.position) || 0) };
  run('INSERT INTO queue(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data', u.id, JSON.stringify(q));
  return { ok: true };
});
