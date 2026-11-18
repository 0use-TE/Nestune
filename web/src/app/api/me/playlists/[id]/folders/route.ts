import { userRoute } from '@/server/guard';
import { body, fail } from '@/server/http';
import { addFolder, removeFolder } from '@/server/playlist-folders';
import type { FolderSource } from '@/lib/playlist-folders';
export const POST = userRoute(async (req, ctx, user) => {
  const id = (await ctx.params).id; if (!/^[1-9]\d{0,11}$/.test(id)) throw fail(400, '歌单编号无效');
  return addFolder(user.id, Number(id), await body<FolderSource>(req));
});
export const DELETE = userRoute(async (req, ctx, user) => {
  const id = (await ctx.params).id, folder = req.nextUrl.searchParams.get('folder');
  if (!/^[1-9]\d{0,11}$/.test(id) || !folder || !/^[1-9]\d{0,11}$/.test(folder)) throw fail(400, '文件夹编号无效');
  return removeFolder(user.id, Number(id), Number(folder));
});
