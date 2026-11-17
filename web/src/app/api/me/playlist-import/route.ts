import { userRoute } from '@/server/guard';
import { body, str } from '@/server/http';
import { externalPlaylist, importPlaylist, resolvePlaylistLink } from '@/server/playlist-import';
export const POST = userRoute(async (req, _ctx, user) => {
  const input = await body<{ link: string; confirm?: boolean; name?: string }>(req), link = str(input.link, 1, 2000, '分享链接');
  if (input.confirm) return importPlaylist(user.id, link, input.name);
  return externalPlaylist(await resolvePlaylistLink(link));
}, { bucket: 'playlist-import' });
