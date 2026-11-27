import { userRoute } from '@/server/guard';
import { tasteMap } from '@/server/taste-map';

export const GET = userRoute((_req, _ctx, user) => tasteMap(user.id), { bucket: 'taste-map' });
