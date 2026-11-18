import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/server/guard', () => ({ userRoute: (handler: unknown) => handler }));
vi.mock('@/server/catalog', () => ({}));
vi.mock('@/server/uploads', () => ({}));
vi.mock('@/server/listening-queue', () => ({ initializeListeningQueue: vi.fn() }));
vi.mock('@/server/social', () => ({ syncSocial: vi.fn(() => ({ ok: true })) }));

import { POST } from '@/app/api/social/route';
import { initializeListeningQueue } from '@/server/listening-queue';

const post = (data: unknown) => (POST as unknown as (req: NextRequest, ctx: unknown, user: { id: number }, session: string) => Promise<unknown>)(
  new NextRequest('http://localhost/api/social', { method: 'POST', body: JSON.stringify(data) }), {}, { id: 1 }, 'test-session',
);
beforeEach(() => vi.clearAllMocks());

it('accepts a full shared queue with shuffle history larger than the old 64 KiB limit', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `qq-${String(i).padStart(77, '0')}`);
  const seed = { ids, index: 499, position: 0, mode: 'shuffle', shuffle: { seen: ids, history: ids, cursor: 499 } };
  const data = { action: 'sync', roomId: 1, seed };
  expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(65536);
  await expect(post(data)).resolves.toEqual({ ok: true });
  expect(initializeListeningQueue).toHaveBeenCalledWith({ userId: 1, sessionId: 'test-session' }, 1, seed);
});

it('rejects oversized sync requests before initializing a queue', async () => {
  await expect(post({ action: 'sync', roomId: 1, seed: 'x'.repeat(131072) })).rejects.toMatchObject({ status: 413 });
  expect(initializeListeningQueue).not.toHaveBeenCalled();
});
