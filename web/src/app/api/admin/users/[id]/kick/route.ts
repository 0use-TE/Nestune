import { kickUser } from '@/server/auth';
import { fail } from '@/server/http';
import { adminRoute } from '@/server/guard';

export const POST = adminRoute(async (_req, ctx) => {
  const id = (await ctx.params).id;
  if (!/^\d+$/.test(id)) throw fail(400, '用户 ID 无效');
  kickUser(Number(id));
  return { ok: true };
});
