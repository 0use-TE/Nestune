import { adminRoute } from '@/server/guard';
import { workerJob } from '@/server/worker';

export const GET = adminRoute(async (_req, ctx) => workerJob((await ctx.params).id));
