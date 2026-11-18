import { userRoute } from '@/server/guard';
import { canvasImage } from '@/server/canvas';

export const runtime = 'nodejs';
const read = async (req: Request, ctx: { params: Promise<Record<string, string>> }) =>
  canvasImage((await ctx.params).name, req.headers.get('if-none-match'));
export const GET = userRoute(read);
