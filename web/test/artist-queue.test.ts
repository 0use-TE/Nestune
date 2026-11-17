import { expect, it, vi } from 'vitest';
import { loadArtistQueue, type ArtistSongsPage } from '@/lib/artist-queue';
import type { Song } from '@/lib/types';
const song = (id: number, playable = true) => ({ id: String(id), access: { playable } }) as Song;
it('loads beyond the 50 hot songs, retains order, skips unavailable tracks and deduplicates overlapping pages', async () => {
  const pages: ArtistSongsPage[] = [
    { songs: Array.from({ length: 100 }, (_, i) => song(i, i !== 3)), more: true, total: 151 },
    { songs: [song(99), ...Array.from({ length: 51 }, (_, i) => song(i + 100))], more: false, total: 151 },
  ];
  const load = vi.fn(async () => pages.shift()!);
  const result = await loadArtistQueue(load, new AbortController().signal);
  expect(load.mock.calls).toEqual([[0, 100], [100, 100]]);
  expect(result.songs.map(s => s.id)).toEqual(Array.from({ length: 151 }, (_, i) => String(i)).filter(id => id !== '3'));
  expect(result.limited).toBe(false);
});
it('bounds large catalogs to the supported queue capacity and reports truncation', async () => {
  const load = vi.fn(async (offset: number, limit: number) => ({ songs: Array.from({ length: limit }, (_, i) => song(offset + i)), more: true, total: 10000 }));
  const result = await loadArtistQueue(load, new AbortController().signal);
  expect(result.songs).toHaveLength(500); expect(result.limited).toBe(true); expect(load).toHaveBeenCalledTimes(5);
});
it('cancels navigation or an explicit cancel before a fetched page can be played', async () => {
  const controller = new AbortController();
  const load = vi.fn(async () => { controller.abort(); return { songs: [song(1)], more: false, total: 1 }; });
  await expect(loadArtistQueue(load, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('propagates a later page failure instead of replacing playback with a partial queue', async () => {
  const load = vi.fn().mockResolvedValueOnce({ songs: [song(1)], more: true, total: 2 }).mockRejectedValueOnce(Error('offline'));
  await expect(loadArtistQueue(load, new AbortController().signal)).rejects.toThrow('offline');
});
it('stops a repeated or empty continuing page instead of looping indefinitely', async () => {
  const load = vi.fn(async () => ({ songs: [song(1)], more: true, total: 20 }));
  await expect(loadArtistQueue(load, new AbortController().signal)).rejects.toThrow('继续加载');
  expect(load).toHaveBeenCalledTimes(2);
});
