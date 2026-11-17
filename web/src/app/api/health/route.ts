import { db } from '@/server/db';
import { fail, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A minimal readiness check; never exposes account data or infrastructure details. */
export const GET = route(() => {
  try { db().prepare('SELECT 1 FROM users LIMIT 1').get(); }
  catch { throw fail(503, '音乐服务暂时无法读取数据，请稍后重试', 'database_unavailable'); }
  return { ok: true, service: 'nestune' };
});
