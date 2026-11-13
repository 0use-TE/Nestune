import { adminRoute } from '@/server/guard';
import { listUsers } from '@/server/users';

export const GET = adminRoute(() => ({ users: listUsers() }));
