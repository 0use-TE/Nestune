import { body, fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { deletePlaylist, getPlaylist, updatePlaylist } from '@/server/playlists';

const pid = (v: string) => { if (!/^\d{1,12}$/.test(v)) throw fail(400, '歌单 ID 无效'); return Number(v); };

export const GET = userRoute(async (_req, ctx, u) => getPlaylist(u.id, pid((await ctx.params).id)));

export const PATCH = userRoute(async (req, ctx, u) => {
  const b = await body<{ name?: string; description?: string; isPublic?: boolean }>(req);
  return { playlist: updatePlaylist(u.id, pid((await ctx.params).id), b) };
});

export const DELETE = userRoute(async (_req, ctx, u) => {
  deletePlaylist(u.id, pid((await ctx.params).id));
  return { ok: true };
});
