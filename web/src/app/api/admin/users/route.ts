import { adminRoute } from '@/server/guard';
import { listUsers } from '@/server/users';
import { now } from '@/server/db';

export const GET = adminRoute(() => {
  const observedAt = now();
  return { observedAt, users: listUsers(observedAt) };
});
