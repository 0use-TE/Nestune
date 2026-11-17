import { intParam, str } from '@/server/http';
import { userRoute } from '@/server/guard';
import { search } from '@/server/netease';
import { searchUploads } from '@/server/uploads';
import { searchSongs } from '@/server/catalog';

export const GET = userRoute(async (req, _ctx, user) => {
  const p = req.nextUrl.searchParams;
  const query = str(p.get('keywords'), 1, 100, '关键词');
  const type = p.get('type') || 'song';
  const limit = Math.max(1, intParam(p.get('limit'), 30, 100));
  const offset = intParam(p.get('offset'), 0, 1_000_000);
  if (type !== 'song') { const r = await search(query, type, limit, offset); return { ...r, nextOffset: offset + limit, hasMore: offset + r.items.length < r.total }; }
  const local = searchUploads(user.id, query, limit, offset);
  try {
    const online = await searchSongs(query, limit, offset);
    return { ...online, items: [...local.items, ...online.items], total: local.total + online.total, hasMore: online.hasMore || offset + limit < local.total };
  } catch (error) {
    if (!local.total) throw error;
    return { type, ...local, nextOffset: offset + limit, hasMore: offset + limit < local.total, warnings: ['在线搜索暂时不可用，已显示上传的歌曲'] };
  }
});
