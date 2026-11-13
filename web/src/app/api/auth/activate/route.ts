import { publicUser, startSession } from '@/server/auth';
import { body, clientIp, route } from '@/server/http';
import { activate } from '@/server/users';

/** Redeem an invitation to create an account, or reset an existing account. */
export const POST = route(async req => {
  const b = await body<{ username: string; code: string; password: string; displayName?: string }>(req);
  const user = await activate(b.username, b.code, b.password, clientIp(req), b.displayName);
  await startSession('user', user.id, req);
  return { user: publicUser(user) };
});
