import { isUploadSong } from '@/lib/upload-types';
import { avatarMime } from '@/server/avatar';
import { userRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { serveFile } from '@/server/media';
import { requireUpload, uploadPath } from '@/server/uploads';

export const GET = userRoute(async (req, ctx, user) => {
  const { id } = await ctx.params;
  if (!isUploadSong(id)) throw fail(404, '封面不存在');
  const row = requireUpload(user.id, id);
  if (!row.cover_file) throw fail(404, '封面不存在');
  return serveFile(req, uploadPath(row.cover_file), avatarMime(row.cover_file), { 'Cache-Control': 'no-store' });
}, { bucket: 'covers', multiplier: 6 });
