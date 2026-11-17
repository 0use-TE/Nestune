import { userRoute } from '@/server/guard';
import { enrichSong } from '@/server/recordings';
import { home } from '@/server/netease';

export const GET = userRoute(async () => { const result = await home(); return { ...result, newSongs: result.newSongs.map(enrichSong) }; });
