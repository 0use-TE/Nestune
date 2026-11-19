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

it('imports an ordered public shared playlist when the bound-account track lookup fails', async () => {
  const trackIds = [{ id: 70713 }, { id: 81824 }, { id: 92935 }];
  const publicTracks = [{ id: 81824, name: 'Second' }, { id: 70713, name: 'First' }];
  const detail = vi.fn(async () => ({
    body: { playlist: { id: 18609450172, name: '导入', privacy: 0, trackCount: 3, trackIds, tracks: publicTracks } },
  }));
  const tracks = vi.fn(async ({ cookie, ids }) => {
    if (typeof cookie === 'string') throw { body: { code: 502 } };
    expect(ids).toBe('92935');
    return { body: { songs: [{ id: 92935, name: 'Third' }] } };
  });
  const cache = new Map();
  vi.stubGlobal('__nt_sess', { cookie: 'MUSIC_U=test' });
  vi.stubGlobal('__nt_meta', cache);
  vi.stubGlobal('__nt_up', { playlist_detail: detail, song_detail: tracks });

  const result = await importablePlaylist('18609450172');
  expect(result.songs.map(song => song.name)).toEqual(['First', 'Second', 'Third']);
  expect(tracks).toHaveBeenCalledTimes(2);
  expect(cache.size).toBe(0);
});
