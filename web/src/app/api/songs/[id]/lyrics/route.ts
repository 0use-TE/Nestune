import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { lyrics } from '@/server/netease';

export const GET = userRoute(async (_req, ctx) => lyrics(numericId((await ctx.params).id)));
