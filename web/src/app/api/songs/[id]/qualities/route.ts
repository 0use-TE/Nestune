import type { Quality } from '@/server/config';
import { numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { inLibrary } from '@/server/library';
import { songMeta } from '@/server/netease';
import { tiersFor } from '@/server/quality';

/**
 * Which quality tiers exist for this song and which the user can actually get, with format, bitrate and size.
 * Answered from the catalog's privilege data, so nothing is downloaded and the music source is not probed per tier.
 */
export const GET = userRoute(async (_req, ctx, u) => {
  const id = numericId((await ctx.params).id);
  const song = await songMeta(id);
  return { id, local: inLibrary(id), canDownload: !!u.can_save, cap: u.max_quality, ...tiersFor(song.qualities, song.access, u.max_quality as Quality) };
});
