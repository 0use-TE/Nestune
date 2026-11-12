import { adminRoute } from '@/server/guard';
import { cacheStats, clearCache } from '@/server/media';

export const GET = adminRoute(() => cacheStats());
export const DELETE = adminRoute(() => ({ removed: clearCache() }));
