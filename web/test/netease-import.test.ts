import { afterEach, expect, it, vi } from 'vitest';
import { importablePlaylist, playlist } from '@/server/netease';

afterEach(() => vi.unstubAllGlobals());

it('imports public likes in order and reports tracks the public response omits', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => String(990000 + index));
  const detail = vi.fn(async () => ({
    body: { playlist: { id: 99, name: '公开喜欢', privacy: 0, specialType: 5, trackCount: 102, trackIds: ids.map(id => ({ id })) } },
  }));
  const tracks = vi.fn(async ({ ids }: { ids: string }) => ({
    body: { songs: ids.split(',').reverse().map(id => ({ id, name: id })) },
  }));
  vi.stubGlobal('__nt_up', { playlist_detail: detail, song_detail: tracks });

  const result = await importablePlaylist('99');
  expect(result.songs.map(song => song.id)).toEqual(ids);
  expect(result.skipped).toBe(1);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(tracks).toHaveBeenCalledTimes(2);
  await expect(playlist('99', 10, 0)).rejects.toMatchObject({ status: 403 });
});

it('rejects private likes before fetching any track details', async () => {
  const tracks = vi.fn();
  vi.stubGlobal('__nt_up', {
    playlist_detail: async () => ({
      body: { playlist: { id: 99, privacy: 10, specialType: 5, trackCount: 1, trackIds: [{ id: 990000 }] } },
    }),
    song_detail: tracks,
  });

  await expect(importablePlaylist('99')).rejects.toMatchObject({ status: 403 });
  expect(tracks).not.toHaveBeenCalled();
});
