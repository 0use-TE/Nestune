import { userRoute } from '@/server/guard';
import { canvasImage } from '@/server/canvas';

export const runtime = 'nodejs';
const read = async (req: Request, ctx: { params: Promise<Record<string, string>> }) =>
  canvasImage((await ctx.params).name, req.headers.get('if-none-match'));
// The wall can request many visible images alongside the canvas sync and player.
export const GET = userRoute(read, { bucket: 'canvas-images', multiplier: 4 });
