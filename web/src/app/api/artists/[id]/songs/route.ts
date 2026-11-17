import { intParam } from '@/server/http';
import { catalogId, catalogArtistSongs as artistSongs } from '@/server/catalog';
import { userRoute } from '@/server/guard';

export const GET = userRoute(async (req, ctx) => artistSongs(catalogId((await ctx.params).id),
  intParam(req.nextUrl.searchParams.get('limit'), 100, 100),
  intParam(req.nextUrl.searchParams.get('offset'), 0, 10000)));
