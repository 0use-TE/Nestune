import { endSession } from '@/server/auth';
import { route } from '@/server/http';

export const POST = route(async () => {
  await endSession('user');
  return { ok: true };
});
