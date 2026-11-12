import { QUALITIES } from '@/server/config';
import { settings } from '@/server/db';
import { fail, numericId } from '@/server/http';
import { userRoute } from '@/server/guard';
import { inLibrary } from '@/server/library';
import { ensureAudio, serveFile } from '@/server/media';
import { songMeta } from '@/server/netease';
import { clampLevel } from '@/server/quality';
import { withSlot } from '@/server/ratelimit';
import type { Quality } from '@/server/config';

export const dynamic = 'force-dynamic';

/**
 * Audio for <audio src>. Cookie-authenticated, Range-capable, cached on disk.
 * Plays the local library copy when there is one; otherwise streams at "standard" unless `level` asks for more
 * (never above the user's limit).
 */
export const GET = userRoute(async (req, ctx, u) => {
  const id = numericId((await ctx.params).id);
  const asked = req.nextUrl.searchParams.get('level');
  if (asked && !QUALITIES.includes(asked as never)) throw fail(400, '不支持的音质参数');
  if (!inLibrary(id)) {
    const song = await songMeta(id);
    if (!song.access.playable) throw fail(403, song.access.reason || '这首歌暂时无法播放', 'no_access');
  }
  const level = clampLevel(asked, u.max_quality as Quality, 'standard');
  const audio = await withSlot(`dl:${u.id}`, settings().maxStreams, () => ensureAudio(id, level), '同时加载的歌曲过多，请稍后再试');
  return serveFile(req, audio.file, audio.mime, { 'X-Audio-Quality': audio.level, 'X-Audio-Source': audio.source });
}, { bucket: 'stream', multiplier: 6 });
