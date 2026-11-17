import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { catalogArtist as artist } from '@/server/catalog';

export const GET = userRoute(async (_req, ctx) => artist(catalogId((await ctx.params).id)));
