import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { songMeta } from '@/server/netease';
import { inLibrary } from '@/server/library';

export const GET = userRoute(async (_req, ctx) => {
  const id = numericId((await ctx.params).id);
  return { song: await songMeta(id), local: inLibrary(id) };
});
