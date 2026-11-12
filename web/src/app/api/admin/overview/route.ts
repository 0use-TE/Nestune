import { onlineCount } from '@/server/auth';
import { VERSION } from '@/server/config';
import { now, one, settings } from '@/server/db';
import { adminRoute } from '@/server/guard';
import { cacheStats } from '@/server/media';
import { status as sourceStatus } from '@/server/netease';
import { workerHealth } from '@/server/worker';

const started = Date.now();

export const GET = adminRoute(async () => {
  const count = (sql: string, ...a: unknown[]) => one<{ n: number }>(sql, ...a)!.n;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [source, worker] = await Promise.all([sourceStatus(), workerHealth()]);
  return {
    version: VERSION,
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    users: {
      total: count('SELECT COUNT(*) n FROM users'),
      active: count("SELECT COUNT(*) n FROM users WHERE status='active'"),
      pending: count("SELECT COUNT(*) n FROM users WHERE status='pending'"),
      disabled: count("SELECT COUNT(*) n FROM users WHERE status='disabled'"),
      online: onlineCount(),
    },
    playsToday: count('SELECT COUNT(*) n FROM history WHERE played_at>=?', dayStart.getTime()),
    library: { songs: count('SELECT COUNT(*) n FROM library'), bytes: one<{ n: number }>('SELECT COALESCE(SUM(size),0) n FROM library')!.n },
    cache: cacheStats(),
    source,
    worker,
    settings: settings(),
    now: now(),
  };
});
