import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { removeFromLibrary } from '@/server/library';

export const DELETE = userRoute(async (_req, ctx, u) => {
  removeFromLibrary(numericId((await ctx.params).id), u);
  return { ok: true };
});
