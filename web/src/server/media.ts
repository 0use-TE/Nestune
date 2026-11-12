import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dir } from './config';
import { all, now, one, run, settings } from './db';
import { fail } from './http';
import { assertMediaUrl, mediaUrl } from './netease';

const MIME: Record<string, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' };
export const mimeOf = (ext: string) => MIME[ext] || 'application/octet-stream';
const safeExt = (e: unknown) => String(e || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp3';

export type Audio = { file: string; mime: string; ext: string; level: string; source: 'library' | 'cache' | 'source'; size: number };
const inflight = ((globalThis as unknown as { __nt_infl?: Map<string, Promise<Audio>> }).__nt_infl ??= new Map());

/* ---------- Range ---------- */
export function parseRange(header: string | null, size: number): null | 'invalid' | { start: number; end: number } {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number, end: number;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export function serveFile(req: Request, file: string, mime: string, headers: Record<string, string> = {}) {
  const size = fs.statSync(file).size;
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', ...headers };
  const r = parseRange(req.headers.get('range'), size);
  if (r === 'invalid') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  const [start, end, status] = r ? [r.start, r.end, 206] : [0, size - 1, 200];
  if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } });
  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(stream, {
    status,
    headers: { ...base, 'Content-Length': String(end - start + 1), ...(r ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) },
  });
}

/* ---------- cache ---------- */
const cacheFile = (id: string, level: string, ext: string) => dir('cache', `${id}-${level}.${ext}`);

export async function fetchSourceAudio(id: string, level: string, signal: AbortSignal) {
  const media = await mediaUrl(id, level);
  const ext = safeExt(media.type);
  let url = media.url;
  for (let hop = 0; hop < 5; hop++) {
    assertMediaUrl(url);
    const response = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw fail(502, '音频重定向失败');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw fail(502, '音频下载失败，请重试');
    }
    return { body: response.body, ext, mime: mimeOf(ext), level: String(media.level || level) };
  }
  throw fail(502, '重定向次数过多');
}

async function download(id: string, level: string): Promise<Audio> {
  const audio = await fetchSourceAudio(id, level, AbortSignal.timeout(300_000));
  const { ext } = audio;
  const part = cacheFile(id, level, ext) + `.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(audio.body as never), fs.createWriteStream(part));
    const size = fs.statSync(part).size;
    if (size < 1024) throw fail(502, '下载到的音频文件无效');
    const final = cacheFile(id, level, ext);
    fs.renameSync(part, final);
    const actual = audio.level;
    run(`INSERT INTO cache(key,song_id,level,actual_level,ext,mime,size,last_access,created_at,hits) VALUES(?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(key) DO UPDATE SET actual_level=excluded.actual_level,ext=excluded.ext,mime=excluded.mime,size=excluded.size,last_access=excluded.last_access`,
      `${id}:${level}`, id, level, actual, ext, mimeOf(ext), size, now(), now());
    evict();
    return { file: final, mime: mimeOf(ext), ext, level: actual, source: 'source', size };
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
}

export function evict() {
  const limit = settings().cacheLimitGb * 1024 ** 3;
  let total = one<{ n: number }>('SELECT COALESCE(SUM(size),0) n FROM cache')!.n;
  if (total <= limit) return 0;
  let removed = 0;
  for (const row of all<{ key: string; song_id: string; level: string; ext: string; size: number }>('SELECT key,song_id,level,ext,size FROM cache ORDER BY last_access ASC')) {
    if (total <= limit * 0.9) break;
    fs.rmSync(cacheFile(row.song_id, row.level, row.ext), { force: true });
    run('DELETE FROM cache WHERE key=?', row.key);
    total -= row.size; removed++;
  }
  return removed;
}

export function clearCache() {
  let n = 0;
  for (const row of all<{ key: string; song_id: string; level: string; ext: string }>('SELECT key,song_id,level,ext FROM cache')) {
    fs.rmSync(cacheFile(row.song_id, row.level, row.ext), { force: true }); n++;
  }
  run('DELETE FROM cache');
  return n;
}
export const cacheStats = () => {
  const r = one<{ n: number; size: number; hits: number }>('SELECT COUNT(*) n, COALESCE(SUM(size),0) size, COALESCE(SUM(hits),0) hits FROM cache')!;
  return { songs: r.n, bytes: r.size, hits: r.hits, limitBytes: settings().cacheLimitGb * 1024 ** 3 };
};

/** Resolve playable audio: local library first, then cache, then the audio source. */
export async function ensureAudio(id: string, level: string): Promise<Audio> {
  const lib = one<{ file: string; ext: string; size: number; level: string }>('SELECT file,ext,size,level FROM library WHERE song_id=?', id);
  if (lib && fs.existsSync(dir('library', lib.file))) {
    return { file: dir('library', lib.file), mime: mimeOf(lib.ext), ext: lib.ext, level: lib.level, source: 'library', size: lib.size };
  }
  const key = `${id}:${level}`;
  const c = one<{ actual_level: string; ext: string; mime: string; size: number }>('SELECT actual_level,ext,mime,size FROM cache WHERE key=?', key);
  if (c && fs.existsSync(cacheFile(id, level, c.ext))) {
    run('UPDATE cache SET last_access=?, hits=hits+1 WHERE key=?', now(), key);
    return { file: cacheFile(id, level, c.ext), mime: c.mime, ext: c.ext, level: c.actual_level, source: 'cache', size: c.size };
  }
  let p = inflight.get(key);
  if (!p) { p = download(id, level).finally(() => inflight.delete(key)); inflight.set(key, p); }
  return p;
}
