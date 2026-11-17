import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/api', () => ({ get: vi.fn() }));
import { get } from '../src/lib/api';
import { personalPlaylistPath, personalPlaylistSongs } from '../src/lib/playlist-queue';
beforeEach(() => vi.mocked(get).mockReset());
it('reads private personal playlists through the owner endpoint and preserves order and duplicates', async () => {
  const songs = [{ id: 'private-1' }, { id: 'song-2' }, { id: 'private-1' }];
  vi.mocked(get).mockResolvedValue({ songs });
  expect(await personalPlaylistSongs('12')).toEqual(songs);
  expect(get).toHaveBeenCalledWith('/api/me/playlists/12');
});
it('rejects invalid identifiers before issuing requests', () => {
  for (const id of ['../12', '0', '-1', '1?x=2', '1.2', '9007199254740992']) expect(() => personalPlaylistPath(id)).toThrow();
  expect(get).not.toHaveBeenCalled();
});
it('does not attempt to append an empty playlist', async () => {
  vi.mocked(get).mockResolvedValue({ songs: [] });
  await expect(personalPlaylistSongs('12')).rejects.toThrow('空');
});
