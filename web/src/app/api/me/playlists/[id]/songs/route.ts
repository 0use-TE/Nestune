import { body, fail } from '@/server/http';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { addSong } from '@/server/playlists';

export const POST = userRoute(async (req, ctx, u) => {
  const id = (await ctx.params).id;
  if (!/^\d{1,12}$/.test(id)) throw fail(400, '歌单 ID 无效');
  const songId = catalogId((await body<{ songId: string }>(req)).songId);
  return addSong(u.id, Number(id), songId);
});
