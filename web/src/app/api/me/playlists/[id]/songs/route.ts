import { body, fail } from '@/server/http';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { addFavoritesToPlaylist, addSong } from '@/server/playlists';

export const POST = userRoute(async (req, ctx, u) => {
  const id = (await ctx.params).id;
  if (!/^\d{1,12}$/.test(id)) throw fail(400, '歌单 ID 无效');
  const action = await body<{ songId?: string; from?: 'favorites' }>(req);
  if (action.from === 'favorites') return addFavoritesToPlaylist(u.id, Number(id));
  return addSong(u.id, Number(id), catalogId(action.songId));
});
