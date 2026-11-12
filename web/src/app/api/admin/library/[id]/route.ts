import { numericId } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { removeFromLibrary } from '@/server/library';

export const DELETE = adminRoute(async (_req, ctx) => {
  removeFromLibrary(numericId((await ctx.params).id));
  return { ok: true };
});
