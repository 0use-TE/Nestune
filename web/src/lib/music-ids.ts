import type { MusicProvider, Song, SongSource } from './types';

export const isQqId = (id: unknown): id is string => typeof id === 'string' && /^qq-[a-zA-Z0-9]{1,64}$/.test(id);
export const isOnlineId = (id: unknown): id is string => typeof id === 'string' && (/^\d{1,20}$/.test(id) || isQqId(id));
export const providerOf = (id: string): MusicProvider => isQqId(id) ? 'qq' : 'netease';
export const musicSources = (s: Song): SongSource[] => s.sources?.length ? s.sources : isOnlineId(s.id) ? [{ id: s.id, provider: providerOf(s.id), access: s.access, qualities: s.qualities }] : [];
export const songIdentity = (s: Song) => s.canonicalId || s.id;
export const sourceIds = (s: Song) => [...new Set([s.id, s.canonicalId, ...musicSources(s).map(x => x.id)].filter((x): x is string => !!x))];
const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
export const recordingMatchKey = (s: Song) => JSON.stringify([norm(s.name), [...new Set(s.artists.map(a => norm(a.name)))].sort(), norm(s.album.name)]);
const versions = (s: Song) => {
  const text = `${s.name} ${s.album.name}`.normalize('NFKC').toLowerCase();
  return [...text.matchAll(/(?:\b(?:live|remix|remaster(?:ed)?|instrumental|acoustic|demo|karaoke|cover|sped\s*up|slowed|mono|stereo|radio\s*edit|taylor.?s\s*version)\b|现场|伴奏|翻唱|重制|重录|不插电|纯音乐|加速|降速|[12]\d{3}\s*(?:版|remaster))/g)].map(x => norm(x[0])).sort().join('|');
};

/** Conservative recording identity: an ambiguous release stays separate. */
export function sameRecording(a: Song, b: Song) {
  if (!isOnlineId(a.id) || !isOnlineId(b.id) || providerOf(a.id) === providerOf(b.id)) return a.id === b.id;
  const artists = (s: Song) => [...new Set(s.artists.map(x => norm(x.name)).filter(Boolean))].sort();
  const aa = artists(a), ba = artists(b);
  return !!norm(a.name) && norm(a.name) === norm(b.name) && aa.length > 0 && JSON.stringify(aa) === JSON.stringify(ba) &&
    !!norm(a.album.name) && norm(a.album.name) === norm(b.album.name) && versions(a) === versions(b) &&
    a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) <= 2;
}

/** Reconcile loaded pages using canonical IDs and source aliases, preserving order. */
export function mergeSongPages(previous: Song[], next: Song[]): Song[] {
  const result: Song[] = [];
  for (const song of [...previous, ...next]) {
    const aliases = new Set(sourceIds(song));
    const index = result.findIndex(old => sourceIds(old).some(id => aliases.has(id)));
    if (index < 0) result.push(song);
    else {
      const old = result[index];
      const sources = [...new Map([...musicSources(old), ...musicSources(song)].map(x => [x.id, x])).values()];
      const canonicalId = song.canonicalId || old.canonicalId || old.id;
      result[index] = { ...old, ...song, id: canonicalId, canonicalId, sources,
        access: sources.some(x => x.access?.playable !== false) ? { playable: true, max: song.access?.max || old.access?.max || 'standard' } : song.access };
    }
  }
  return result;
}
