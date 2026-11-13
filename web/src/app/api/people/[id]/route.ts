import { userRoute } from '@/server/guard';
import { numericId } from '@/server/http';
import { personProfile } from '@/server/playlists';

export const GET = userRoute(async (_req, ctx, user) => personProfile(user.id, Number(numericId((await ctx.params).id))));
