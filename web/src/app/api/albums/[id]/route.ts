import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { catalogAlbum as album } from '@/server/catalog';

export const GET = userRoute(async (_req, ctx) => album(catalogId((await ctx.params).id)));
