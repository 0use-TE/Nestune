import { body } from '@/server/http';
import { userRoute } from '@/server/guard';
import { createPlaylist, listPlaylists } from '@/server/playlists';

export const GET = userRoute((_req, _ctx, u) => ({ playlists: listPlaylists(u.id) }));

export const POST = userRoute(async (req, _ctx, u) => {
  const b = await body<{ name: string; description?: string }>(req);
  return { playlist: createPlaylist(u.id, b.name, b.description) };
});
