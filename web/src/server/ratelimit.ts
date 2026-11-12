import { fail } from './http';

type Bucket = { count: number; reset: number };
const g = globalThis as unknown as { __nt_rl?: Map<string, Bucket>; __nt_act?: Map<string, number> };
const buckets = (g.__nt_rl ??= new Map());
const active = (g.__nt_act ??= new Map());

/** Fixed-window limiter. Throws 429 when the budget is spent. */
export function hit(key: string, limit: number, windowMs = 60_000, message = '请求过于频繁，请稍后重试') {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (++b.count > limit) throw fail(429, message);
}
export const clear = (key: string) => buckets.delete(key);

export function takeSlot(key: string, max: number, message = '同时进行的请求过多，请稍后再试') {
  const n = active.get(key) || 0;
  if (n >= max) throw fail(429, message);
  active.set(key, n + 1);
  return () => { const m = (active.get(key) || 1) - 1; if (m) active.set(key, m); else active.delete(key); };
}

/** Limit simultaneous operations per key. */
export async function withSlot<T>(key: string, max: number, fn: () => Promise<T>, message?: string) {
  const release = takeSlot(key, max, message);
  try { return await fn(); }
  finally { release(); }
}
