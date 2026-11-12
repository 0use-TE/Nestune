import { fail } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { resetUser } from '@/server/users';

/** Forgotten password: clears the password, signs the user out and issues a new activation code. */
export const POST = adminRoute(async (_req, ctx) => {
  const id = (await ctx.params).id;
  if (!/^\d+$/.test(id)) throw fail(400, '用户 ID 无效');
  return resetUser(Number(id));
});
