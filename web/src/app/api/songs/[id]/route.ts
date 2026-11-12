import { catalogId, catalogSong } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { inLibrary } from '@/server/library';

export const GET = userRoute(async (_req, ctx, user) => {
  const id = catalogId((await ctx.params).id);
  return { song: await catalogSong(user.id, id), local: inLibrary(id) };
});
