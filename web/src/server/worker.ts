import { fail } from './http';

/** Client for the internal audio-worker (NCM decrypt / transcode) running on the NAS. */
function conf() {
  const url = (process.env.WORKER_URL || '').replace(/\/$/, '');
  const key = process.env.WORKER_KEY || '';
  return url && key ? { url, key } : null;
}
export const workerConfigured = () => !!conf();

async function req(path: string, init: RequestInit = {}, auth = true) {
  const c = conf();
  if (!c) throw fail(503, '未配置 audio-worker（WORKER_URL / WORKER_KEY）', 'worker_unconfigured');
  try {
    const res = await fetch(c.url + path, {
      ...init,
      headers: { ...(auth ? { Authorization: `Bearer ${c.key}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(res.status === 401 ? 502 : res.status, data?.error || 'audio-worker 返回错误');
    return data;
  } catch (e: any) {
    if (e?.status) throw e;
    throw fail(502, '无法连接 audio-worker');
  }
}

export async function workerHealth() {
  if (!conf()) return { configured: false, ok: false };
  try { await req('/health', {}, false); return { configured: true, ok: true }; }
  catch { return { configured: true, ok: false }; }
}
export const workerJobs = () => req('/jobs');
export const workerJob = (id: string) => req(`/jobs/${encodeURIComponent(id)}`);
export function workerSubmit(input: string, format: 'original' | 'mp3', bitrate?: number) {
  return req('/jobs', { method: 'POST', body: JSON.stringify({ input, format, ...(bitrate ? { bitrate } : {}) }) });
}
