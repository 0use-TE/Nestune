import { userRoute } from '@/server/guard';
import { suggest } from '@/server/netease';

export const GET = userRoute(async req => ({ keywords: await suggest((req.nextUrl.searchParams.get('keywords') || '').trim()) }));
