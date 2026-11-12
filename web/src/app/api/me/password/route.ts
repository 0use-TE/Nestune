import { endSession, kickUser, startSession } from '@/server/auth';
import { body } from '@/server/http';
import { userRoute } from '@/server/guard';
import { changePassword } from '@/server/users';

/** Changing the password signs out every other device. */
export const POST = userRoute(async (req, _ctx, u) => {
  const b = await body<{ current: string; next: string }>(req);
  await changePassword(u, b.current, b.next);
  kickUser(u.id);
  await endSession('user');
  await startSession('user', u.id, req);
  return { ok: true };
});
