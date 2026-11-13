import { adminRoute } from '@/server/guard';
import { revokeActivationCode } from '@/server/users';

export const DELETE = adminRoute(async (_req, ctx) => {
  const { id } = await ctx.params;
  revokeActivationCode(Number(id));
  return { ok: true };
});
