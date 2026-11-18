import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/server/guard', () => ({ userRoute: (handler: unknown) => handler }));
vi.mock('@/server/catalog', () => ({
  catalogId: (id: string) => id,
  onlineSongs: async (ids: string[]) => ids.map(id => ({ id, canonicalId: id === 'qq-a' ? '1' : id, name: id, artists: [], album: { id: null, name: '' }, cover: null, duration: 200 })),
}));
let db: typeof import('@/server/db'), routes: typeof import('@/app/api/me/queue/route'), folder: string;
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-shuffle-storage-')); vi.stubEnv('DATA_DIR', folder);
  db = await import('@/server/db'); routes = await import('@/app/api/me/queue/route');
  for (const id of [1, 2]) db.run("INSERT INTO users(id,username,status,created_at) VALUES(?,?,'active',?)", id, `u${id}`, Date.now());
});
beforeEach(() => db.run('DELETE FROM queue'));
afterAll(() => { db.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const get = (userId = 1) => (routes.GET as unknown as (req: NextRequest, ctx: unknown, user: { id: number }) => Promise<any>)(new NextRequest('http://localhost/api/me/queue'), {}, { id: userId });
const put = (body: unknown, userId = 1) => (routes.PUT as unknown as (req: NextRequest, ctx: unknown, user: { id: number }) => Promise<any>)(new NextRequest('http://localhost/api/me/queue', { method: 'PUT', body: JSON.stringify(body) }), {}, { id: userId });

it('restores shuffle mode, round and history from server storage, including canonical source aliases', async () => {
  await put({ ids: ['qq-a','2','3'], index: 1, position: 15, mode: 'shuffle', shuffle: { seen: ['1','2'], history: ['1','2'], cursor: 1 } });
  expect(await get()).toMatchObject({ index: 1, position: 15, mode: 'shuffle', shuffle: { seen: ['1','2'], history: ['1','2'], cursor: 1 } });
  expect(await get(2)).toMatchObject({ songs: [], shuffle: { seen: [] } });
});
it('supports old queues and old clients without erasing an already saved round', async () => {
  db.run('INSERT INTO queue(user_id,data) VALUES(1,?)', JSON.stringify({ ids: ['1','2'], index: 0, position: 12 }));
  expect(await get()).toMatchObject({ mode: 'off', shuffle: { seen: ['1'], history: ['1'] } });
  await put({ ids: ['1','2','3'], index: 1, position: 0, mode: 'shuffle', shuffle: { seen: ['1','2'], history: ['1','2'], cursor: 1 } });
  await put({ ids: ['1','2','3'], index: 1, position: 7 });
  expect(await get()).toMatchObject({ mode: 'shuffle', position: 7, shuffle: { seen: ['1','2'] } });
});
it('bounds untrusted history and does not expose removed identities or another user state', async () => {
  await put({ ids: ['1','2'], index: 0, mode: 'shuffle', shuffle: { seen: ['not-in-queue','1'], history: ['not-in-queue','1'], cursor: 1 } });
  const value = await get(); expect(value.shuffle).toEqual({ seen: ['1'], history: ['1'], cursor: 0 });
  await expect(put({ ids: ['1'], index: 0, mode: 'invalid' })).rejects.toThrow('播放模式无效');
});
