import { adminKey } from '@/server/config';
import { requireAdmin } from '@/server/auth';
import { json, route } from '@/server/http';

/** Lets the panel know whether it is unlocked and whether the server is configured at all. */
export const GET = route(async () => {
  if (!adminKey()) return json({ configured: false, admin: false });
  try { await requireAdmin(); return json({ configured: true, admin: true }); }
  catch { return json({ configured: true, admin: false }); }
});
