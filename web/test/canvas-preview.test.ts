import { expect, it, vi } from 'vitest';
vi.mock('@/server/catalog', () => ({ catalogSong: vi.fn(async (_user: number, id: string) => ({ id, name: 'Preview', duration: id === '2' ? 8 : 200 })) }));
vi.mock('@/server/netease', () => ({ chorus: vi.fn(async (id: string) => id === '1' ? { start: 82, end: 110 } : null) }));
import { songPreview } from '@/server/preview';
import { chorus } from '@/server/netease';

it('uses a real chorus marker and caps the excerpt at fifteen seconds', async () => {
  expect(await songPreview(1, '1')).toMatchObject({ start: 82, end: 97, method: 'chorus' });
  await songPreview(1, '1');
  expect(vi.mocked(chorus).mock.calls.filter(([id]) => id === '1')).toHaveLength(1);
});
it('falls back honestly without requesting NetEase markers for QQ tracks', async () => {
  expect(await songPreview(1, 'qq-track')).toMatchObject({ start: 70, end: 85, method: 'excerpt' });
  expect(vi.mocked(chorus).mock.calls.some(([id]) => id === 'qq-track')).toBe(false);
  expect(await songPreview(1, '2')).toMatchObject({ start: 0, end: 8, method: 'excerpt' });
});
