import { body, fail } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { workerHealth, workerJobs, workerSubmit } from '@/server/worker';

export const GET = adminRoute(async () => {
  const health = await workerHealth();
  if (!health.ok) return { ...health, jobs: [] };
  const r = await workerJobs();
  return { ...health, jobs: r.jobs ?? r };
});

/** Submit an audio job. `input` is a path relative to the worker's incoming folder. */
export const POST = adminRoute(async req => {
  const b = await body<{ input: string; format?: string; bitrate?: number }>(req);
  const input = String(b.input || '').trim();
  if (!input || input.length > 300) throw fail(400, '请提供输入文件路径');
  const format = b.format === 'mp3' ? 'mp3' : 'original';
  return workerSubmit(input, format, format === 'mp3' ? Number(b.bitrate) || 320 : undefined);
});
