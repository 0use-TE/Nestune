import { endSession } from '@/server/auth';
import { route } from '@/server/http';

export const POST = route(async () => {
  await endSession('admin');
  return { ok: true };
});
