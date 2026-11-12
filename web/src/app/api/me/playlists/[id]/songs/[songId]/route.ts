import { fail } from '@/server/http';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { removeSong } from '@/server/playlists';

export const DELETE = userRoute(async (_req, ctx, u) => {
  const p = await ctx.params;
  if (!/^\d{1,12}$/.test(p.id)) throw fail(400, '歌单 ID 无效');
  removeSong(u.id, Number(p.id), catalogId(p.songId));
  return { ok: true };
});
