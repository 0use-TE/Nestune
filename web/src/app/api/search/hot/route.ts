import { userRoute } from '@/server/guard';
import { hotSearch } from '@/server/netease';

export const GET = userRoute(async () => ({ keywords: await hotSearch() }));
