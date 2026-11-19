import { adminKey } from '@/server/config';
import { adminAccess } from '@/server/auth';
import { route } from '@/server/http';

/** Lets the panel know whether it is unlocked and whether the server is configured at all. */
export const GET = route(async () => {
  const access = await adminAccess();
  return { configured: Boolean(adminKey()) || access === 'account', admin: !!access, access };
});
