import { intParam, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { artistSongs } from '@/server/netease';

export const GET = userRoute(async (req, ctx) => artistSongs(numericId((await ctx.params).id),
  intParam(req.nextUrl.searchParams.get('limit'), 100, 100),
  intParam(req.nextUrl.searchParams.get('offset'), 0, 10000)));
