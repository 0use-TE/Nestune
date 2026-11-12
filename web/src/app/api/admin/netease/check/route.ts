import { fail } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { qrCheck } from '@/server/netease';

export const GET = adminRoute(req => {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (!/^[\w-]{8,80}$/.test(key)) throw fail(400, '二维码标识无效');
  return qrCheck(key);
});
