import type { MusicProvider, Song, SongSource } from './types';

export const isQqId = (id: unknown): id is string => typeof id === 'string' && /^qq-[a-zA-Z0-9]{1,64}$/.test(id);
export const isOnlineId = (id: unknown): id is string => typeof id === 'string' && (/^\d{1,20}$/.test(id) || isQqId(id));
export const providerOf = (id: string): MusicProvider => isQqId(id) ? 'qq' : 'netease';
export const musicSources = (s: Song): SongSource[] => s.sources?.length ? s.sources : isOnlineId(s.id) ? [{ id: s.id, provider: providerOf(s.id), access: s.access, qualities: s.qualities }] : [];
export const songIdentity = (s: Song) => s.canonicalId || s.id;
export const sourceIds = (s: Song) => [...new Set([s.id, s.canonicalId, ...musicSources(s).map(x => x.id)].filter((x): x is string => !!x))];
const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const title = (s: Song) => norm(s.recordingTitle || s.name);
const artists = (s: Song) => [...new Set(s.artists.map(a => norm(a.name)).filter(Boolean))].sort();
export function normalizeIsrc(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : undefined;
}
export const recordingMatchKey = (s: Song) => JSON.stringify([title(s), artists(s), norm(s.album.name)]);
const versions = (s: Song) => {
  const text = `${s.name} ${s.album.name}`.normalize('NFKC').toLowerCase();
  return [...new Set([...text.matchAll(/(?:\b(?:live|remix|remaster(?:ed)?|instrumental|acoustic|demo|karaoke|cover|sped\s*up|slowed|mono|stereo|radio\s*edit|taylor.?s\s*version)\b|现场|伴奏|翻唱|混音|重制|重录|不插电|纯音乐|加速|降速|[12]\d{3}\s*(?:版|remaster))/g)].map(x => norm(x[0])))].sort().join('|');
};

/** Conservative recording identity: an ambiguous release stays separate. */
export function sameRecording(a: Song, b: Song) {
  if (!isOnlineId(a.id) || !isOnlineId(b.id) || providerOf(a.id) === providerOf(b.id)) return a.id === b.id;
  if (versions(a) !== versions(b) || a.duration <= 0 || b.duration <= 0 || Math.abs(a.duration - b.duration) > 2) return false;
  const firstId = normalizeIsrc(a.isrc), secondId = normalizeIsrc(b.isrc);
  if (firstId && secondId) return firstId === secondId;
  return !!title(a) && artists(a).length > 0 && !!norm(a.album.name) && recordingMatchKey(a) === recordingMatchKey(b);
}

/** Reconcile loaded pages using canonical IDs and source aliases, preserving order. */
export function mergeSongPages(previous: Song[], next: Song[]): Song[] {
  const result: Song[] = [];
  for (const song of [...previous, ...next]) {
    const aliases = new Set(sourceIds(song));
    const matches = result.flatMap((old, index) => sourceIds(old).some(id => aliases.has(id)) ? [{ old, index }] : []);
    const [first, ...duplicates] = matches;
    if (!first) { result.push(song); continue; }

    const sources = [...new Map([...matches.map(match => match.old), song].flatMap(musicSources).map(source => [source.id, source])).values()];
    if (!sources.length) { result[first.index] = { ...first.old, ...song }; continue; }
    const canonicalId = song.canonicalId || first.old.canonicalId || first.old.id;
    result[first.index] = { ...first.old, ...song, id: canonicalId, canonicalId, sources,
      access: sources.some(source => source.access?.playable !== false) ? { playable: true, max: song.access?.max || first.old.access?.max || 'standard' } : song.access };
    for (const { index } of duplicates.reverse()) result.splice(index, 1);
  }
  return result;
}
