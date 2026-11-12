import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { artist } from '@/server/netease';

export const GET = userRoute(async (_req, ctx) => artist(numericId((await ctx.params).id)));
