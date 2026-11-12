import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { QUALITIES, type Quality } from '@/server/config';
import { settings } from '@/server/db';
import { userRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { fetchSourceAudio, serveFile } from '@/server/media';
import { songMeta } from '@/server/netease';
import { tiersFor } from '@/server/quality';
import { takeSlot } from '@/server/ratelimit';
import { requireUpload, uploadAudio } from '@/server/uploads';

export const POST = userRoute(async (req, ctx, user) => {
  if (!user.can_save) throw fail(403, '此账号没有下载权限');
  const id = catalogId((await ctx.params).id);
  const wanted = req.nextUrl.searchParams.get('level');
  if (isUploadSong(id)) {
    const audio = uploadAudio(requireUpload(user.id, id));
    if (wanted !== 'original') throw fail(400, '请选择原始文件');
    return serveFile(req, audio.path, audio.mime, { 'Cache-Control': 'no-store', 'X-Audio-Format': audio.ext });
  }
  if (!QUALITIES.some(level => level === wanted)) throw fail(400, '不支持的音质');
  const song = await songMeta(id);
  const plan = tiersFor(song.qualities, song.access, user.max_quality as Quality);
  const tier = plan.tiers.find(item => item.level === wanted);
  if (!tier) throw fail(400, '不支持的音质');
  if (tier.state !== 'ok') throw fail(403, plan.reason || '此账号无法下载所选音质');

  const release = takeSlot(`dl:${user.id}`, settings().maxStreams, '同时加载的歌曲过多，请稍后再试');
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]);
  let released = false;
  function done() {
    if (released) return;
    released = true;
    signal.removeEventListener('abort', done);
    release();
  }
  signal.addEventListener('abort', done, { once: true });
  try {
    const audio = await fetchSourceAudio(id, tier.level, signal);
    if (!audio.mime.startsWith('audio/')) {
      await audio.body.cancel();
      throw fail(502, '音源返回了不支持的文件格式');
    }
    const reader = audio.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { done(); controller.close(); }
          else controller.enqueue(chunk.value);
        } catch (error) { done(); controller.error(error); }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } finally { done(); }
      },
    });
    return new Response(body, { headers: {
      'Cache-Control': 'no-store',
      'Content-Type': audio.mime,
      'X-Audio-Format': audio.ext,
    } });
  } catch (error) {
    done();
    throw error;
  }
}, { bucket: 'stream', multiplier: 6 });
