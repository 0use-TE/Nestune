import { MAX_AVATAR, avatarMime, sniffImage } from '@/server/avatar';
import { userRoute } from '@/server/guard';
import { fail, numericId } from '@/server/http';
import { cover, songMeta } from '@/server/netease';

export const GET = userRoute(async (req, ctx) => {
  const song = await songMeta(numericId((await ctx.params).id));
  const url = cover(song.cover);
  if (!url?.startsWith('https://')) throw fail(404, '找不到封面');
  const source = await fetch(url, {
    redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(8000)]),
  }).catch(() => { throw fail(502, '无法读取封面'); });
  if (!source.ok || !source.body || Number(source.headers.get('Content-Length')) > MAX_AVATAR) {
    await source.body?.cancel();
    throw fail(502, '无法读取封面');
  }
  const reader = source.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_AVATAR) { await reader.cancel(); throw fail(502, '封面文件过大'); }
    parts.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(parts);
  const ext = sniffImage(bytes);
  if (!ext) throw fail(502, '封面格式无效');
  return new Response(bytes, { headers: { 'Content-Type': avatarMime(`cover.${ext}`), 'Cache-Control': 'no-store' } });
}, { bucket: 'covers' });
