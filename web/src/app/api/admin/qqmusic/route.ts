import { adminRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { qqLogout, qqQrCreate, qqStatus } from '@/server/qqmusic';

export const GET = adminRoute(() => qqStatus());
export const POST = adminRoute(req => {
  const type = req.nextUrl.searchParams.get('type') || 'qq';
  if (type !== 'qq' && type !== 'wx') throw fail(400, '扫码方式无效');
  return qqQrCreate(type);
});
export const DELETE = adminRoute(() => { qqLogout(); return { ok: true }; });
