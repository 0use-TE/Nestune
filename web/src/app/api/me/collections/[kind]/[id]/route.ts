import { userRoute } from '@/server/guard';
import { collect, collectionTarget, isCollected, uncollect } from '@/server/collections';

export const GET = userRoute(async (_req, ctx, user) => {
  const params = await ctx.params, target = collectionTarget(params.kind, params.id);
  return { favorite: isCollected(user.id, target.kind, target.id) };
});
export const PUT = userRoute(async (_req, ctx, user) => {
  const params = await ctx.params, target = collectionTarget(params.kind, params.id);
  await collect(user.id, target.kind, target.id);
  return { favorite: true };
});
export const DELETE = userRoute(async (_req, ctx, user) => {
  const params = await ctx.params, target = collectionTarget(params.kind, params.id);
  uncollect(user.id, target.kind, target.id);
  return { favorite: false };
});
