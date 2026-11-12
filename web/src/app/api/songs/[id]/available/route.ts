import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { available } from '@/server/netease';
import { inLibrary } from '@/server/library';

export const GET = userRoute(async (_req, ctx) => {
  const id = numericId((await ctx.params).id);
  if (inLibrary(id)) return { available: true, local: true };
  return { ...(await available(id)), local: false };
});
