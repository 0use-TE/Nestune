import { userRoute } from '@/server/guard';
import { canvasImage } from '@/server/canvas';

export const runtime = 'nodejs';
const read = async (_req: Request, ctx: { params: Promise<Record<string, string>> }) => canvasImage((await ctx.params).name);
export const GET = userRoute(read);
