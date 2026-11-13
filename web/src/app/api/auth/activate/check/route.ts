import { body, clientIp, route } from '@/server/http';
import { checkActivation } from '@/server/users';

export const POST = route(async req => {
  const { code } = await body<{ code: string }>(req);
  return checkActivation(code, clientIp(req));
});
