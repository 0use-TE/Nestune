import { intParam, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { enrichSong, rememberSongs } from '@/server/recordings';
import { playlist } from '@/server/netease';

export const GET = userRoute(async (req, ctx) => {
  const p = req.nextUrl.searchParams;
  const result = await playlist(numericId((await ctx.params).id), intParam(p.get('limit'), 50, 100), intParam(p.get('offset'), 0, 1_000_000));
  rememberSongs(result.songs); return { ...result, songs: result.songs.map(enrichSong) };
});
