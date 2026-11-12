import { body, fail, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { addSong } from '@/server/playlists';

export const POST = userRoute(async (req, ctx, u) => {
  const id = (await ctx.params).id;
  if (!/^\d{1,12}$/.test(id)) throw fail(400, '歌单 ID 无效');
  const songId = numericId((await body<{ songId: string }>(req)).songId);
  return addSong(u.id, Number(id), songId);
});
