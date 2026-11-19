import { wallTileImage } from '@/server/canvas-wall';
import { userRoute } from '@/server/guard';

export const runtime = 'nodejs';
export const GET = userRoute(async (req, ctx) => {
  const { x, y } = await ctx.params;
  return wallTileImage(Number(x), Number(y), req.nextUrl.searchParams.get('v'), req.headers.get('if-none-match'));
}, { bucket: 'canvas-images', multiplier: 4 });
