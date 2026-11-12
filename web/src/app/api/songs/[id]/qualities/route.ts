import type { Quality } from '@/server/config';
import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { inLibrary } from '@/server/library';
import { songMeta } from '@/server/netease';
import { requireUpload, uploadAudio } from '@/server/uploads';
import { tiersFor } from '@/server/quality';

/**
 * Which quality tiers exist for this song and which the user can actually get, with format, bitrate and size.
 * Answered from the catalog's privilege data, so nothing is downloaded and the music source is not probed per tier.
 */
export const GET = userRoute(async (_req, ctx, u) => {
  const id = catalogId((await ctx.params).id);
  if (isUploadSong(id)) {
    const audio = uploadAudio(requireUpload(u.id, id));
    return { id, playable: true, canDownload: !!u.can_save, best: 'original',
      tiers: [{ level: 'original', label: '原始文件', format: audio.ext.toUpperCase(), bitrate: null, size: audio.size, state: 'ok' }] };
  }
  const song = await songMeta(id);
  return { id, local: inLibrary(id), canDownload: !!u.can_save, cap: u.max_quality, ...tiersFor(song.qualities, song.access, u.max_quality as Quality) };
});
