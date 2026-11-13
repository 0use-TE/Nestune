import { userRoute } from '@/server/guard';
import { collected } from '@/server/collections';

export const GET = userRoute((_req, _ctx, user) => ({ items: collected(user.id) }));
