import { userRoute } from '@/server/guard';
import { catalogId } from '@/server/catalog';
import { songPreview } from '@/server/preview';
export const GET = userRoute(async (_req, ctx, user) => songPreview(user.id, catalogId((await ctx.params).id)));
