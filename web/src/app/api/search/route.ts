import { intParam, str } from '@/server/http';
import { userRoute } from '@/server/guard';
import { search } from '@/server/netease';
import { searchUploads } from '@/server/uploads';

export const GET = userRoute(async (req, _ctx, user) => {
  const p = req.nextUrl.searchParams;
  const query = str(p.get('keywords'), 1, 100, '关键词');
  const type = p.get('type') || 'song';
  const limit = intParam(p.get('limit'), 30, 100);
  const offset = intParam(p.get('offset'), 0, 1_000_000);
  if (type !== 'song') return search(query, type, limit, offset);
  const local = searchUploads(user.id, query, limit, offset);
  const remaining = limit - local.items.length;
  try {
    const online = await search(query, type, Math.max(1, remaining), Math.max(0, offset - local.total));
    return { type, items: [...local.items, ...online.items.slice(0, remaining)], total: local.total + online.total };
  } catch (error) {
    if (!local.total) throw error;
    return { type, ...local };
  }
});
