import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { lyrics } from '@/server/netease';
import { uploadLyrics } from '@/server/uploads';

export const GET = userRoute(async (_req, ctx, user) => {
  const id = catalogId((await ctx.params).id);
  return isUploadSong(id) ? uploadLyrics(user.id, id) : lyrics(id);
});
