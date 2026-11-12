import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { requireUpload } from '@/server/uploads';
import { userRoute } from '@/server/guard';
import { available } from '@/server/netease';
import { inLibrary } from '@/server/library';

export const GET = userRoute(async (_req, ctx, user) => {
  const id = catalogId((await ctx.params).id);
  if (isUploadSong(id)) { requireUpload(user.id, id); return { available: true }; }
  if (inLibrary(id)) return { available: true, local: true };
  return { ...(await available(id)), local: false };
});
