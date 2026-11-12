import { isUploadSong } from '@/lib/upload-types';
import { userRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { withSlot } from '@/server/ratelimit';
import { deleteUpload, saveUpload, uploadForm } from '@/server/uploads';

export const PATCH = userRoute(async (req, ctx, user) => {
  const { id } = await ctx.params;
  if (!isUploadSong(id)) throw fail(404, '歌曲不存在');
  return withSlot('upload-writes', 2, async () => ({ upload: await saveUpload(user.id, await uploadForm(req), id) }));
}, { bucket: 'uploads' });

export const DELETE = userRoute(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  if (!isUploadSong(id)) throw fail(404, '歌曲不存在');
  deleteUpload(user.id, id);
}, { bucket: 'uploads' });
