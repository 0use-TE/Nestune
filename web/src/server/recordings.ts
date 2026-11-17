import type { Song } from '@/lib/types';
import { isOnlineId, mergeSongPages, providerOf, sameRecording, recordingMatchKey } from '@/lib/music-ids';
import { all, db, now, one, run } from './db';

type Row = { source_id: string; recording_id: string; meta: string; checked_at: number };
export const recordingId = (id: string) => isOnlineId(id) ? one<Row>('SELECT recording_id FROM music_sources WHERE source_id=?', id)?.recording_id || id : id;
export const recordingAliases = (id: string): string[] => isOnlineId(id) ? [...new Set([id, ...all<Row>('SELECT source_id FROM music_sources WHERE recording_id=?', recordingId(id)).map(x => x.source_id)])] : [id];
export const matchingDue = (id: string) => !one<Row>('SELECT source_id FROM music_sources WHERE source_id=? AND checked_at>?', id, now() - 86400_000);
export const markMatched = (id: string) => run('UPDATE music_sources SET checked_at=? WHERE source_id=?', now(), id);
export function cachedOnlineSong(id: string): Song | undefined {
  const row = one<Row>('SELECT meta FROM music_sources WHERE source_id=?', id);
  return row ? JSON.parse(row.meta) : undefined;
}

/** Keep original source IDs resolvable; merging never rewrites a user's stored songs. */
export function rememberSongs(songs: Song[]) {
  const list = songs.filter(s => isOnlineId(s.id));
  if (!list.length) return;
  db().exec('SAVEPOINT music_identity');
  try {
    for (const s of list) {
      const { sources: _sources, canonicalId: _canonical, ...plain } = s;
      run(`INSERT INTO music_sources(source_id,recording_id,meta,match_key,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET meta=excluded.meta,match_key=excluded.match_key,updated_at=excluded.updated_at`, s.id, s.id, JSON.stringify(plain), recordingMatchKey(s), now());
    }
    const candidates = (s: Song) => all<Row>('SELECT * FROM music_sources WHERE match_key=? AND source_id<>? LIMIT 100', recordingMatchKey(s), s.id)
      .map(r => JSON.parse(r.meta) as Song).filter(x => sameRecording(s, x));
    for (const a of list) {
      const possible = candidates(a);
      if (possible.length !== 1) continue;
      const b = possible[0];
      if (candidates(b).length !== 1) continue;
      const ar = recordingId(a.id), br = recordingId(b.id);
      if (ar === br) continue;
      const members = all<Row>('SELECT * FROM music_sources WHERE recording_id IN (?,?)', ar, br).map(r => JSON.parse(r.meta) as Song);
      if (!members.every((x, k) => members.slice(k + 1).every(y => sameRecording(x, y)))) continue;
      const root = members.map(x => x.id).sort((x, y) => Number(providerOf(x) === 'qq') - Number(providerOf(y) === 'qq') || x.localeCompare(y))[0];
      run('UPDATE music_sources SET recording_id=? WHERE recording_id IN (?,?)', root, ar, br);
    }
    db().exec('RELEASE music_identity');
  } catch (e) { db().exec('ROLLBACK TO music_identity'); db().exec('RELEASE music_identity'); throw e; }
}

export function enrichSong(song: Song): Song {
  if (!isOnlineId(song.id)) return song;
  const canonicalId = recordingId(song.id);
  const members = all<Row>('SELECT * FROM music_sources WHERE recording_id=? ORDER BY source_id', canonicalId);
  if (!members.length && typeof song.name === 'string' && song.album && Array.isArray(song.artists)) {
    rememberSongs([song]); return enrichSong(song);
  }
  const sources = members.map(r => JSON.parse(r.meta) as Song).map(s => ({ id: s.id, provider: providerOf(s.id), access: s.access, qualities: s.qualities }));
  if (!sources.length) sources.push({ id: song.id, provider: providerOf(song.id), access: song.access, qualities: song.qualities });
  const playable = sources.some(s => s.access?.playable !== false);
  return { ...song, provider: providerOf(song.id), canonicalId, sources,
    access: playable ? { playable: true, max: sources.find(s => s.access?.playable !== false)?.access?.max || 'standard' } : song.access };
}
export const uniqueRecordings = <T extends Song>(songs: T[]): T[] => {
  const seen = new Set<string>();
  return songs.filter(song => { const id = recordingId(song.id); if (seen.has(id)) return false; seen.add(id); return true; });
};
export const mergedSongs = (songs: Song[]) => mergeSongPages([], songs.map(s => ({ ...enrichSong(s), id: recordingId(s.id) })));
