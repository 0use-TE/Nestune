import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { album } from '@/server/netease';

export const GET = userRoute(async (_req, ctx) => album(numericId((await ctx.params).id)));
