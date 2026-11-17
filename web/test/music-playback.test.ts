import { beforeEach, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';
const mocks = vi.hoisted(() => ({ discover: vi.fn(), online: vi.fn(), audio: vi.fn(), qq: vi.fn(), library: vi.fn(), aliases: vi.fn() }));
vi.mock('@/server/catalog', () => ({ discoverSources: mocks.discover, onlineSong: mocks.online }));
vi.mock('@/server/media', () => ({ ensureAudio: mocks.audio }));
vi.mock('@/server/library', () => ({ inLibrary: mocks.library }));
vi.mock('@/server/qqmusic', () => ({ qqMediaUrl: mocks.qq }));
vi.mock('@/server/recordings', () => ({ recordingAliases: mocks.aliases }));
import { downloadSourceId, lyricSource, playableAudio, playbackOptions } from '@/server/music-playback';
const track: Song = { id: '1', name: 'Song', duration: 240, cover: null, artists: [], album: { id: null, name: '' }, sources: [
  { id: '1', provider: 'netease', access: { playable: false, max: null } }, { id: 'qq-a', provider: 'qq', access: { playable: true, max: 'lossless' } }], canonicalId: '1' };
beforeEach(() => { vi.resetAllMocks(); mocks.discover.mockResolvedValue(track); mocks.online.mockResolvedValue(track); mocks.audio.mockImplementation(async id => ({ file: id })); mocks.library.mockReturnValue(false); mocks.aliases.mockReturnValue(['1', 'qq-a']); });
it('falls back to an authorized source and caches by the actual platform song ID', async () => {
  await expect(playableAudio('1', 'standard', { prefer: 'auto' })).resolves.toMatchObject({ provider: 'qq', sourceId: 'qq-a', file: 'qq-a' });
  expect(mocks.qq).toHaveBeenCalledWith('qq-a', 'standard'); expect(mocks.audio).toHaveBeenCalledExactlyOnceWith('qq-a', 'standard');
});
it('honors manual selection without silently switching platforms', async () => {
  await expect(playableAudio('1', 'standard', { prefer: 'auto', source: 'netease' })).rejects.toMatchObject({ status: 403 });
  expect(mocks.qq).not.toHaveBeenCalled(); expect(mocks.audio).not.toHaveBeenCalled();
});
it('does not expose cached QQ audio after the account loses full playback permission', async () => {
  mocks.qq.mockRejectedValue({ status: 403, code: 'qq_no_access' });
  await expect(playableAudio('1', 'standard', { prefer: 'qq', source: 'qq' })).rejects.toMatchObject({ code: 'qq_no_access' });
  expect(mocks.audio).not.toHaveBeenCalled();
});
it('can fall back after the preferred upstream fails and keeps saved library copies playable', async () => {
  mocks.qq.mockRejectedValue({ status: 502 }); mocks.library.mockReturnValue(true);
  await expect(playableAudio('1', 'standard', { prefer: 'qq' })).resolves.toMatchObject({ provider: 'qq' });
  expect(mocks.qq).not.toHaveBeenCalled();
  mocks.library.mockReturnValue(false); mocks.online.mockResolvedValue({ ...track, sources: track.sources!.map(s => ({ ...s, access: { playable: true, max: 'exhigh' } })) });
  await expect(playableAudio('1', 'standard', { prefer: 'qq' })).resolves.toMatchObject({ provider: 'netease', sourceId: '1' });
});
it('binds lyrics to the selected recording and keeps QQ playback separate from downloads', () => {
  expect(lyricSource('1', 'qq-a')).toBe('qq-a'); expect(() => lyricSource('1', 'qq-other')).toThrow();
  expect(downloadSourceId('qq-a')).toBe('1'); mocks.aliases.mockReturnValue(['qq-a']);
  expect(() => downloadSourceId('qq-a')).toThrow('暂不提供下载');
  expect(playbackOptions(new URLSearchParams('prefer=qq&source=netease'))).toEqual({ prefer: 'qq', source: 'netease' });
  expect(() => playbackOptions(new URLSearchParams('source=https://evil.test'))).toThrow();
});
