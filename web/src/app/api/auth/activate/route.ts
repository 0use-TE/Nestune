import { publicUser, startSession } from '@/server/auth';
import { body, clientIp, route } from '@/server/http';
import { activate } from '@/server/users';

/** First login: username + one-time activation code + the user's own new password. */
export const POST = route(async req => {
  const b = await body<{ username: string; code: string; password: string }>(req);
  const user = await activate(b.username, b.code, b.password, clientIp(req));
  await startSession('user', user.id, req);
  return { user: publicUser(user) };
});
