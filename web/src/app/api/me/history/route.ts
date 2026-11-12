import { all, now, one, run } from '@/server/db';
import { body, intParam, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { songMeta } from '@/server/netease';

export const GET = userRoute((req, _ctx, u) => {
  const limit = intParam(req.nextUrl.searchParams.get('limit'), 50, 200, 'limit');
  const rows = all<{ meta: string; played_at: number }>(
    `SELECT meta, MAX(played_at) played_at FROM history WHERE user_id=? GROUP BY song_id ORDER BY played_at DESC LIMIT ?`, u.id, limit);
  return { songs: rows.map(r => ({ ...JSON.parse(r.meta), playedAt: r.played_at })) };
});

/** Record a play. Repeating the same song within 30 seconds is ignored. */
export const POST = userRoute(async (req, _ctx, u) => {
  const id = numericId((await body<{ songId: string }>(req)).songId);
  const last = one<{ song_id: string; played_at: number }>('SELECT song_id,played_at FROM history WHERE user_id=? ORDER BY id DESC LIMIT 1', u.id);
  if (last && last.song_id === id && now() - last.played_at < 30_000) return { ok: true, duplicate: true };
  const meta = await songMeta(id);
  run('INSERT INTO history(user_id,song_id,meta,played_at) VALUES(?,?,?,?)', u.id, id, JSON.stringify(meta), now());
  run('DELETE FROM history WHERE user_id=? AND id NOT IN (SELECT id FROM history WHERE user_id=? ORDER BY id DESC LIMIT 2000)', u.id, u.id);
  return { ok: true };
});

export const DELETE = userRoute((_req, _ctx, u) => {
  run('DELETE FROM history WHERE user_id=?', u.id);
  return { ok: true };
});
