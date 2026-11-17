import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { lyrics } from '@/server/netease';
import { uploadLyrics } from '@/server/uploads';
import { isQqId } from '@/lib/music-ids';
import { qqLyrics } from '@/server/qqmusic';
import { lyricSource } from '@/server/music-playback';

export const GET = userRoute(async (req, ctx, user) => {
  const id = catalogId((await ctx.params).id);
  if (isUploadSong(id)) return uploadLyrics(user.id, id);
  const sourceId = lyricSource(id, req.nextUrl.searchParams.get('sourceId'));
  const result = isQqId(sourceId) ? await qqLyrics(sourceId) : await lyrics(sourceId);
  return { ...result, id, sourceId };
});
