import type { MusicPreference, MusicProvider } from '@/lib/types';
import { musicSources, isQqId, providerOf } from '@/lib/music-ids';
import { discoverSources, onlineSong } from './catalog';
import { fail } from './http';
import { ensureAudio } from './media';
import { inLibrary } from './library';
import { qqMediaUrl } from './qqmusic';
import { recordingAliases } from './recordings';

export function playbackOptions(params: URLSearchParams): { source?: MusicProvider; prefer: MusicPreference } {
  const source = params.get('source'), prefer = params.get('prefer') || 'auto';
  if (source && source !== 'qq' && source !== 'netease' || !['auto', 'qq', 'netease'].includes(prefer)) throw fail(400, '音源参数无效');
  return { source: source as MusicProvider | undefined, prefer: prefer as MusicPreference };
}
export async function playableAudio(id: string, level: string, options: { source?: MusicProvider; prefer: MusicPreference }) {
  const song = await discoverSources(id);
  const preferred = options.prefer === 'qq' ? 'qq' : 'netease';
  const sources = musicSources(song).filter(s => !options.source || s.provider === options.source)
    .sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  if (!sources.length) throw fail(404, '这首歌没有所选音源');
  let last: unknown;
  for (const source of sources) {
    try {
      const actual = await onlineSong(source.id);
      // A library file is an independent, previously saved copy.
      if (!inLibrary(source.id)) {
        if (source.provider === 'qq') await qqMediaUrl(source.id, level);
        else if (actual.sources?.find(s => s.id === source.id)?.access?.playable === false) throw fail(403, actual.sources.find(s => s.id === source.id)?.access?.reason || '网易云账号没有这首歌的播放权限', 'no_access');
      }
      const audio = await ensureAudio(source.id, level);
      return { ...audio, provider: source.provider, sourceId: source.id, song };
    } catch (e) { last = e; }
  }
  throw last || fail(403, '两个音源均无法完整播放这首歌', 'no_access');
}
export function lyricSource(id: string, asked: string | null) {
  if (!asked) return id;
  if (!recordingAliases(id).includes(asked)) throw fail(400, '歌词音源与歌曲不匹配');
  return asked;
}
export const downloadSourceId = (id: string) => {
  const ne = recordingAliases(id).find(s => providerOf(s) === 'netease');
  if (!ne || isQqId(ne)) throw fail(403, 'QQ 音乐暂不提供下载，可以在线播放', 'download_unsupported');
  return ne;
};
