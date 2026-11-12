import { body, fail } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { deleteUser, updateUser } from '@/server/users';

const uid = (v: string) => { if (!/^\d+$/.test(v)) throw fail(400, '用户 ID 无效'); return Number(v); };

export const PATCH = adminRoute(async (req, ctx) => {
  const b = await body<{ status?: string; maxQuality?: string; displayName?: string }>(req);
  return { user: updateUser(uid((await ctx.params).id), b) };
});

export const DELETE = adminRoute(async (_req, ctx) => {
  deleteUser(uid((await ctx.params).id));
  return { ok: true };
});
