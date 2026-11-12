import { userRoute } from '@/server/guard';
import { home } from '@/server/netease';

export const GET = userRoute(() => home());
