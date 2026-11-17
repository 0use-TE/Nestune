import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { QUALITIES } from '@/server/config';
import { settings } from '@/server/db';
import { fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { serveFile } from '@/server/media';
import { playableAudio, playbackOptions } from '@/server/music-playback';
import { clampLevel } from '@/server/quality';
import { withSlot } from '@/server/ratelimit';
import { requireUpload, uploadAudio } from '@/server/uploads';
import type { Quality } from '@/server/config';

export const dynamic = 'force-dynamic';

/**
 * Audio for <audio src>. Cookie-authenticated, Range-capable, cached on disk.
 * Plays the local library copy when there is one; otherwise streams at "standard" unless `level` asks for more
 * (never above the user's limit).
 */
export const GET = userRoute(async (req, ctx, u) => {
  const id = catalogId((await ctx.params).id);
  if (isUploadSong(id)) {
    const audio = uploadAudio(requireUpload(u.id, id));
    return serveFile(req, audio.path, audio.mime, { 'Cache-Control': 'no-store', 'X-Audio-Source': 'upload' });
  }
  const asked = req.nextUrl.searchParams.get('level');
  if (asked && !QUALITIES.includes(asked as never)) throw fail(400, '不支持的音质参数');
  const level = clampLevel(asked, u.max_quality as Quality, 'standard');
  const options = playbackOptions(req.nextUrl.searchParams);
  const audio = await withSlot(`dl:${u.id}`, settings().maxStreams, () => playableAudio(id, level, options), '同时加载的歌曲过多，请稍后再试');
  return serveFile(req, audio.file, audio.mime, { 'X-Audio-Quality': audio.level, 'X-Audio-Source': audio.source, 'X-Music-Provider': audio.provider, 'X-Music-Source-Id': audio.sourceId,
    'X-Music-Sources': JSON.stringify(audio.song.sources?.map(s => ({ id: s.id, provider: s.provider })) || []), 'X-Recording-Id': audio.song.canonicalId || id });
}, { bucket: 'stream', multiplier: 6 });
