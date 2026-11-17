import { adminRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { qqQrCheck } from '@/server/qqmusic';

export const GET = adminRoute(req => {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (key.length < 1 || key.length > 256 || /[\x00-\x1f\x7f]/.test(key)) throw fail(400, '二维码标识无效');
  return qqQrCheck(key);
});
