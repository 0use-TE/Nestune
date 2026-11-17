import { sourceIds } from './music-ids';
import type { Song } from './types';

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const variants = [
  /\blive\b|现场|現場|演唱会|演唱會/iu,
  /\binstrumental\b|\bkaraoke\b|伴奏|纯音乐|純音樂|钢琴|鋼琴/iu,
  /\bdj\b|\bremix\b|混音/iu,
  /\bcover\b|翻唱/iu,
  /\bsped\s*up\b|\bslowed\b|加速|降速/iu,
  /\bacoustic\b|不插电|不插電/iu,
];

function relevance(query: string, song: Song) {
  const q = normalize(query), title = normalize(song.recordingTitle || song.name);
  const artists = song.artists.map(a => normalize(a.name)).filter(Boolean);
  // Remove an explicitly requested artist before comparing the title; this also
  // handles queries without spaces. A credit in the title is never artist proof.
  let rest = q, artistMatch = false;
  for (const artist of [...artists].sort((a, b) => b.length - a.length)) {
    if (artist.length >= 2 && rest.includes(artist)) { rest = rest.replace(artist, ''); artistMatch = true; }
  }
  let score = q === title ? 100 : title && (title.includes(q) || q.includes(title)) ? 62 : 0;
  if (artistMatch) score = Math.max(score, rest === title || !rest ? 140 : title.includes(rest) ? 105 : 48);
  const text = normalize(`${song.name} ${song.artists.map(a => a.name).join(' ')} ${song.album.name}`);
  const tokens = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
  if (tokens.length) score = Math.max(score, 44 * tokens.filter(token => text.includes(token)).length / tokens.length);

  const versionText = `${song.name} ${song.album.name}`;
  const unrequested = variants.filter(pattern => pattern.test(versionText) && !pattern.test(query)).length;
  const requested = variants.some(pattern => pattern.test(query) && pattern.test(versionText));
  score += requested ? 22 : 0;
  score -= Math.min(32, unrequested * 18);
  // A named release is a small metadata signal, never an "original singer" flag.
  score += song.album.name.trim() ? song.album.id ? 4 : 2 : 0;
  if (/精选|精選|合集|\bgreatest\s*hits\b|\bcompilation\b/iu.test(song.album.name) &&
      !/精选|精選|合集|\bgreatest\s*hits\b|\bcompilation\b/iu.test(query)) score -= 5;
  return score;
}

/** Rerank the fetched batch. Loaded pages keep their positions in the client.
 * Each group is one provider's original ranking. Upload recency is not a rank.
 * A second source contributes a small agreement bonus, not twice the relevance.
 */
export function rankSearchSongs(query: string, songs: Song[], providerPages: Song[][] = [], offset = 0): Song[] {
  const ranks = providerPages.map(page => {
    const result = new Map<string, number>();
    page.forEach((song, index) => {
      for (const id of sourceIds(song)) if (!result.has(id)) result.set(id, offset + index + 1);
    });
    return result;
  });
  const scored = songs.map(song => {
    const aliases = sourceIds(song);
    const votes = ranks.flatMap(group => {
      const positions = aliases.flatMap(id => group.has(id) ? [group.get(id)!] : []);
      return positions.length ? [28 / (1 + (Math.min(...positions) - 1) / 8)] : [];
    }).sort((a, b) => b - a);
    return { song, score: relevance(query, song) + (votes[0] ?? 12) + (votes[1] ?? 0) * .12 };
  });
  return scored.sort((a, b) => b.score - a.score ||
    a.song.name.localeCompare(b.song.name, 'zh-CN') ||
    a.song.artists.map(x => x.name).join('/').localeCompare(b.song.artists.map(x => x.name).join('/'), 'zh-CN') ||
    a.song.id.localeCompare(b.song.id)).map(item => item.song);
}
