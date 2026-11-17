import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { requireUpload } from '@/server/uploads';
import { userRoute } from '@/server/guard';
import { available } from '@/server/netease';
import { inLibrary } from '@/server/library';
import { isQqId } from '@/lib/music-ids';
import { qqMediaUrl } from '@/server/qqmusic';

export const GET = userRoute(async (_req, ctx, user) => {
  const id = catalogId((await ctx.params).id);
  if (isUploadSong(id)) { requireUpload(user.id, id); return { available: true }; }
  if (inLibrary(id)) return { available: true, local: true };
  if (isQqId(id)) {
    try { await qqMediaUrl(id, 'standard'); return { available: true, local: false }; }
    catch { return { available: false, message: 'QQ 音乐当前无法完整播放', local: false }; }
  }
  return { ...(await available(id)), local: false };
});
