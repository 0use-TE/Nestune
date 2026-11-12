import { now, one, run } from '@/server/db';
import { catalogId, catalogSong } from '@/server/catalog';
import { userRoute } from '@/server/guard';

export const PUT = userRoute(async (_req, ctx, u) => {
  const id = catalogId((await ctx.params).id);
  if (!one('SELECT 1 x FROM favorites WHERE user_id=? AND song_id=?', u.id, id)) {
    const meta = await catalogSong(u.id, id);
    run('INSERT OR IGNORE INTO favorites(user_id,song_id,meta,created_at) VALUES(?,?,?,?)', u.id, id, JSON.stringify(meta), now());
  }
  return { favorite: true };
});

export const DELETE = userRoute(async (_req, ctx, u) => {
  run('DELETE FROM favorites WHERE user_id=? AND song_id=?', u.id, catalogId((await ctx.params).id));
  return { favorite: false };
});
