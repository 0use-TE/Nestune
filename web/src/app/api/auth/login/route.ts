import { publicUser, startSession } from '@/server/auth';
import { body, clientIp, route } from '@/server/http';
import { login } from '@/server/users';

export const POST = route(async req => {
  const b = await body<{ username: string; password: string }>(req);
  const user = await login(b.username, b.password, clientIp(req));
  await startSession('user', user.id, req);
  return { user: publicUser(user) };
});
