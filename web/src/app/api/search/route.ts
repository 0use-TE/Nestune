import { intParam } from '@/server/http';
import { userRoute } from '@/server/guard';
import { search } from '@/server/netease';

export const GET = userRoute((req) => {
  const p = req.nextUrl.searchParams;
  return search((p.get('keywords') || '').trim(), p.get('type') || 'song', intParam(p.get('limit'), 30, 100), intParam(p.get('offset'), 0, 1_000_000));
});
