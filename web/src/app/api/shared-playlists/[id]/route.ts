import { userRoute } from '@/server/guard';
import { numericId } from '@/server/http';
import { sharedPlaylist } from '@/server/playlists';

export const GET = userRoute(async (_req, ctx, user) => sharedPlaylist(user.id, Number(numericId((await ctx.params).id))));
