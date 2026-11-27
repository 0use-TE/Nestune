import { requireUserSession } from '@/server/auth';
import { wallTileImage } from '@/server/canvas-wall';
import { route } from '@/server/http';
import { hit } from '@/server/ratelimit';

export const runtime = 'nodejs';

const WALL_BYTES_PER_MINUTE = 64 * 1024 * 1024;
const WALL_REQUEST_COST = 16 * 1024;

export const GET = route(async (req, ctx) => {
  const { user } = await requireUserSession();
  const { x, y } = await ctx.params;
  let response: Response | undefined;
  try {
    response = wallTileImage(Number(x), Number(y), req.nextUrl.searchParams.get('v'), req.headers.get('if-none-match'));
    return response;
  } finally {
    const bytes = Number(response?.headers.get('content-length') ?? 0);
    hit('canvas-wall:' + user.id, WALL_BYTES_PER_MINUTE, 60_000, '涂鸦区块请求过多，稍后将自动补载', WALL_REQUEST_COST + bytes);
  }
});
