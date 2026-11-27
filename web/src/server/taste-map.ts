import { isOnlineId, isQqId } from '@/lib/music-ids';
import type { TasteCenter, TasteMap, TasteTrack } from '@/lib/taste-map';
import type { Song } from '@/lib/types';
import { all } from './db';
import { discoverySongs, session, songGenres, tasteCenterSongs } from './netease';
import { qqArtistSongs, qqConfigured } from './qqmusic';
import { recordingId } from './recordings';

type Genre = { id: string; label: string };
type Signal = { key: string; song: Song; weight: number; tags: Genre[] };
type Candidate = { key: string; song: Song; centers: Set<string> };
type CatalogRow = { source_id: string; recording_id: string; meta: string };
const MIX_SIZE = 36;
const GRAPH_SIZE = 60;
const day = 86_400_000;

/** Share only public catalogue lookups by song, artist or genre. Profiles are computed per request. */
function catalogCache<T>() {
  const entries = new Map<string, { expires: number; value: Promise<T[]> }>();
  return async (key: string, load: () => Promise<T[]>): Promise<T[]> => {
    let entry = entries.get(key);
    if (!entry || entry.expires <= Date.now()) {
      if (entries.size >= 320) entries.delete(entries.keys().next().value!);
      const fresh = { expires: Date.now() + 900_000, value: Promise.resolve<T[]>([]) };
      fresh.value = load().catch(() => { fresh.expires = Date.now() + 30_000; return []; });
      entries.set(key, fresh);
      entry = fresh;
    }
    // A slow upstream may finish warming the catalogue cache, but cannot hold up the page.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        entry.value,
        new Promise<T[]>(resolve => { timer = setTimeout(() => resolve([]), 1600); }),
      ]);
    } finally { clearTimeout(timer); }
  };
}
const cachedGenres = catalogCache<Genre>();
const cachedSongs = catalogCache<Song>();

function readSong(meta: string): Song | undefined {
  try {
    const song: Song = JSON.parse(meta);
    if (isOnlineId(song?.id) && !song.uploader && song.name && Array.isArray(song.artists) && song.album) return song;
  } catch { /* Old or incomplete catalogue metadata is not a usable node. */ }
}

function personalSignals(user: number, now: number) {
  const rows = all<{ meta: string; recording_id: string | null; weight: number; at: number }>(`
    WITH fav AS (SELECT song_id, meta, 6 AS weight, created_at AS at FROM favorites
        WHERE user_id=? ORDER BY created_at DESC LIMIT 240),
      plays AS (SELECT song_id, meta, 1 AS weight, played_at AS at FROM history
        WHERE user_id=? ORDER BY played_at DESC LIMIT 400),
      saved AS (SELECT s.song_id, s.meta, 3 AS weight, s.added_at AS at FROM playlist_songs s
        JOIN playlists p ON p.id=s.playlist_id WHERE p.user_id=? ORDER BY s.added_at DESC LIMIT 240)
    SELECT signals.*, m.recording_id FROM (
      SELECT * FROM fav UNION ALL SELECT * FROM plays UNION ALL SELECT * FROM saved
    ) signals LEFT JOIN music_sources m ON m.source_id=signals.song_id`, user, user, user);
  const signals = new Map<string, Signal>();
  for (const row of rows) {
    const song = readSong(row.meta);
    if (!song || song.access?.playable === false) continue;
    const key = row.recording_id || song.canonicalId || song.id;
    const signal = signals.get(key) ?? { key, song, weight: 0, tags: [] };
    const ageDays = Math.max(0, now - row.at) / day;
    signal.weight += row.weight / (1 + ageDays / 90);
    signals.set(key, signal);
  }
  for (const signal of signals.values()) signal.weight = Math.min(signal.weight, 15);
  return [...signals.values()].sort((a, b) => b.weight - a.weight);
}

const artistKey = (id: string) => 'artist:' + id;
const tagKey = (id: string) => 'tag:' + id;

function chooseCenters(signals: Signal[]): TasteCenter[] {
  const scores = new Map<string, TasteCenter>();
  function add(kind: 'artist' | 'tag', id: string, label: string, weight: number) {
    const center = scores.get(id) ?? { id, label, kind, weight: 0 };
    center.weight += weight;
    scores.set(id, center);
  }
  for (const { song, weight, tags } of signals) {
    const artists = song.artists.filter(a => isOnlineId(a.id) && a.name);
    for (const artist of artists) add('artist', artistKey(artist.id), artist.name, weight / artists.length);
    for (const tag of tags) add('tag', tagKey(tag.id), tag.label, weight / tags.length);
  }
  const ranked = [...scores.values()].sort((a, b) => b.weight - a.weight);
  const tags = ranked.filter(center => center.kind === 'tag').slice(0, 3);
  const artists = ranked.filter(center => center.kind === 'artist').slice(0, 6 - tags.length);
  return [...artists, ...tags].sort((a, b) => b.weight - a.weight).map(center => ({
    ...center, weight: center.weight / ranked[0].weight,
  }));
}

function balance(groups: Candidate[][], limit: number) {
  const result = new Map<string, Candidate>();
  for (let position = 0; result.size < limit && groups.some(group => position < group.length); position++) {
    for (const group of groups) {
      const item = group[position];
      if (item) result.set(item.key, item);
      if (result.size === limit) break;
    }
  }
  return [...result.values()];
}

export async function tasteMap(user: number): Promise<TasteMap> {
  const signals = personalSignals(user, Date.now());

  const represented = new Set<string>();
  // Sample different artists before spending a second genre lookup on the same artist.
  const eligible = signals.filter(s => !isQqId(s.key) && isOnlineId(s.key));
  const sample = eligible.filter(s => {
    const artist = s.song.artists[0]?.id;
    if (!artist || represented.has(artist)) return false;
    represented.add(artist); return true;
  });
  const seeds = [...new Set([...sample, ...eligible])].slice(0, 4);
  await Promise.all(seeds.map(async s => { s.tags = await cachedGenres(s.key, () => songGenres(s.key)); }));
  const centers = chooseCenters(signals);

  const selected = new Set(centers.map(center => center.id));
  const profile = new Map(signals.map(s => [s.key, s]));
  const candidates = new Map<string, Candidate>();
  function playedCandidates() {
    const rows = all<{ key: string }>(`WITH keys(key) AS (SELECT value FROM json_each(?)),
      sources(key, source_id) AS (
        SELECT key, key FROM keys UNION ALL
        SELECT k.key, m.source_id FROM keys k JOIN music_sources m ON m.recording_id=k.key
      )
      SELECT DISTINCT s.key FROM sources s JOIN heard_songs h ON h.user_id=? AND h.song_id=s.source_id`,
      JSON.stringify([...candidates.keys()]), user);
    return new Set(rows.map(row => row.key));
  }

  // Only provider metadata enters the candidate pool. No other user's plays, private
  // playlists or uploaded recordings contribute either weights or recommendations.
  const local = all<CatalogRow>('SELECT source_id, recording_id, meta FROM music_sources ORDER BY rowid DESC LIMIT 640');
  const catalogue = local.flatMap(row => {
    const song = readSong(row.meta);
    return song && row.source_id === song.id ? [{ song, key: row.recording_id }] : [];
  });
  const blocked = new Set(catalogue.filter(row => row.song.access?.playable === false).map(row => row.song.id));
  function offer(song: Song, key: string, tags: string[] = []) {
    if (!isOnlineId(song.id) || blocked.has(song.id) || song.access?.playable === false) return;
    const edges = [...song.artists.map(a => artistKey(a.id)), ...tags].filter(id => selected.has(id));
    if (!edges.length) return;
    const candidate = candidates.get(key) ?? { key, song, centers: new Set<string>() };
    for (const id of edges) candidate.centers.add(id);
    candidates.set(key, candidate);
  }
  for (const signal of signals) offer(signal.song, signal.key, signal.tags.map(tag => tagKey(tag.id)));
  for (const item of catalogue) offer(item.song, item.key);

  const account = session().savedAt || 'guest';
  const pages = await Promise.all(centers.map(center => {
    const id = center.id.slice(center.id.indexOf(':') + 1);
    return cachedSongs(account + '/' + center.id, async () => {
      if (isQqId(id)) return qqConfigured() ? (await qqArtistSongs(id, 60, 0)).songs : [];
      return tasteCenterSongs(center.kind === 'tag' ? 'tag' : 'artist', id);
    });
  }));
  centers.forEach((center, index) => {
    for (const song of pages[index]) offer(song, recordingId(song.id), center.kind === 'tag' ? [center.id] : []);
  });

  // Fill short discovery pools from the public catalogue. Keep the source
  // visible as its own center instead of attributing those songs to a taste tag.
  let heard = playedCandidates();
  if ([...candidates.keys()].filter(key => !heard.has(key)).length < MIX_SIZE) {
    const extras = await cachedSongs(account + '/discovery', discoverySongs);
    const fallbackId = 'discovery:catalog';
    selected.add(fallbackId);
    for (const item of [...extras.map(song => ({ song, key: recordingId(song.id) })), ...catalogue]) {
      if (!candidates.has(item.key)) offer(item.song, item.key, [fallbackId]);
    }
    heard = playedCandidates();
    if ([...candidates.values()].some(c => c.centers.has(fallbackId))) {
      centers.push({ id: fallbackId, kind: 'discovery', label: '曲库探索', weight: .3 });
    }
  }
  const groups = centers.map(center => [...candidates.values()]
    .filter(item => item.centers.has(center.id))
    .sort((a, b) => Number(profile.has(a.key)) - Number(profile.has(b.key))
      || (profile.get(b.key)?.weight ?? 0) - (profile.get(a.key)?.weight ?? 0)));
  const ranked = balance(groups, candidates.size);
  const discovery = (item: Candidate) => item.centers.size === 1 && item.centers.has('discovery:catalog');
  const fresh = ranked.filter(item => !heard.has(item.key));
  const mix = [...fresh.filter(item => !discovery(item)), ...fresh.filter(discovery),
    ...ranked.filter(item => heard.has(item.key))].slice(0, MIX_SIZE);
  const anchors = groups.flatMap(group => group.find(item => profile.has(item.key)) ?? []);
  const graph = [...new Set([...mix, ...anchors, ...ranked])].slice(0, GRAPH_SIZE);
  const tracks = graph.map(({ key, song, centers: edges }): TasteTrack => {
    const memberships = centers.filter(center => edges.has(center.id));
    const labels = memberships.map(center => center.label).join('、');
    const reason = edges.has('discovery:catalog') ? '来自可探索的在线曲库' :
      profile.has(key) ? `来自你的听歌记录或音乐库，与「${labels}」相关` : `与你听过或收藏的音乐同属「${labels}」`;
    return { song, centerIds: memberships.map(center => center.id), reason, unheard: !heard.has(key) };
  });
  const visible = new Set(tracks.flatMap(track => track.centerIds));
  return { centers: centers.filter(center => visible.has(center.id)), tracks, mixIds: mix.map(item => item.song.id) };
}
