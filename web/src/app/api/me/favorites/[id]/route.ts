import { now, one, run } from '@/server/db';
import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { songMeta } from '@/server/netease';

export const PUT = userRoute(async (_req, ctx, u) => {
  const id = numericId((await ctx.params).id);
  if (!one('SELECT 1 x FROM favorites WHERE user_id=? AND song_id=?', u.id, id)) {
    const meta = await songMeta(id);
    run('INSERT OR IGNORE INTO favorites(user_id,song_id,meta,created_at) VALUES(?,?,?,?)', u.id, id, JSON.stringify(meta), now());
  }
  return { favorite: true };
});

export const DELETE = userRoute(async (_req, ctx, u) => {
  run('DELETE FROM favorites WHERE user_id=? AND song_id=?', u.id, numericId((await ctx.params).id));
  return { favorite: false };
});
