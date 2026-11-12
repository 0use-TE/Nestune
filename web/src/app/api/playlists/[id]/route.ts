import { intParam, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { playlist } from '@/server/netease';

export const GET = userRoute(async (req, ctx) => {
  const p = req.nextUrl.searchParams;
  return playlist(numericId((await ctx.params).id), intParam(p.get('limit'), 50, 100), intParam(p.get('offset'), 0, 1_000_000));
});
