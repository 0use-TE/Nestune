import { body } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { createUser, listUsers } from '@/server/users';

export const GET = adminRoute(() => ({ users: listUsers() }));

/** Creates a pending account and returns a one-time activation code (shown once). */
export const POST = adminRoute(async req => {
  const b = await body<{ username: string; displayName?: string; maxQuality?: string }>(req);
  return createUser(b);
});
