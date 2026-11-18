import { sourceIds } from './music-ids';
import type { Song } from './types';

export type ShuffleState = { seen: string[]; history: string[]; cursor: number };
const LIMIT = 500;
export const emptyShuffle = (): ShuffleState => ({ seen: [], history: [], cursor: -1 });

function recordingKeys(songs: Song[]) {
  const parents = new Map<string, string>();
  const root = (id: string) => {
    let key = id;
    while (parents.get(key) && parents.get(key) !== key) key = parents.get(key)!;
    let cursor = id;
    while (parents.get(cursor) && parents.get(cursor) !== key) { const next = parents.get(cursor)!; parents.set(cursor, key); cursor = next; }
    return key;
  };
  for (const song of songs) {
    const ids = sourceIds(song);
    for (const id of ids) {
      if (!parents.has(id)) parents.set(id, id);
      const a = root(ids[0]), b = root(id);
      const [first, second] = [a, b].sort((x, y) => Number(x.startsWith('qq-')) - Number(y.startsWith('qq-')) || x.localeCompare(y));
      parents.set(second, first);
    }
  }
  const aliases = new Map([...parents.keys()].map(id => [id, root(id)]));
  return { aliases, keys: songs.map(song => aliases.get(song.id) ?? song.id) };
}

/** Bounded JSON state, also accepts old queues with no shuffle information. */
export function readShuffle(value: unknown, limit = LIMIT): ShuffleState {
  if (!value || typeof value !== 'object') return emptyShuffle();
  const raw = value as Partial<ShuffleState>;
  const ids = (list: unknown) => Array.isArray(list) ? list.slice(-limit).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 80) : [];
  const history = ids(raw.history);
  const removed = Array.isArray(raw.history) ? Math.max(0, raw.history.length - limit) : 0;
  const cursor = Number.isSafeInteger(raw.cursor) ? Math.max(-1, Math.min(history.length - 1, raw.cursor! - removed)) : history.length - 1;
  return { seen: [...new Set(ids(raw.seen))], history, cursor };
}

/** Reconcile by recording identity, not row index: edits and duplicate sources
 * cannot give a previously played song another chance in the same round. */
export function createShuffle(songs: Song[], index: number, previous?: unknown): ShuffleState {
  const limit = Math.max(LIMIT, songs.length);
  const oldSeen = previous && typeof previous === 'object' ? (previous as Partial<ShuffleState>).seen : undefined;
  // Filter removed songs before shrinking a previously larger in-memory round.
  const raw = readShuffle(previous, Math.max(limit, Array.isArray(oldSeen) ? Math.min(10000, oldSeen.length) : 0)), { aliases, keys } = recordingKeys(songs);
  const seen = [...new Set(raw.seen.flatMap(id => aliases.has(id) ? [aliases.get(id)!] : []))];
  const history: string[] = []; let cursor = -1;
  raw.history.forEach((id, position) => {
    const canonical = aliases.get(id);
    if (canonical) { if (history.at(-1) !== canonical) history.push(canonical); if (position <= raw.cursor) cursor = history.length - 1; }
  });
  const current = keys[index];
  if (current) {
    if (!seen.includes(current)) seen.push(current);
    if (history[cursor] !== current) { history.splice(cursor + 1); history.push(current); cursor = history.length - 1; }
  }
  const trim = Math.max(0, history.length - limit);
  return { seen, history: history.slice(trim), cursor: Math.max(-1, cursor - trim) };
}

export function shuffleNext(songs: Song[], index: number, previous?: unknown, random = Math.random) {
  let state = createShuffle(songs, index, previous);
  if (!songs.length) return { index: -1, state };
  const { keys } = recordingKeys(songs);
  if (songs[index] && state.cursor + 1 < state.history.length) {
    state = { ...state, cursor: state.cursor + 1 };
    return { index: keys.indexOf(state.history[state.cursor]), state };
  }
  const identities = [...new Set(keys)], current = keys[index];
  const seen = new Set(state.seen);
  let candidates = identities.filter(id => id !== current && !seen.has(id));
  if (!candidates.length) {
    state = { ...state, seen: [] };
    candidates = identities.filter(id => id !== current);
  }
  const draw = random();
  const pick = Number.isFinite(draw) ? Math.max(0, Math.min(candidates.length - 1, Math.floor(draw * candidates.length))) : 0;
  const chosen = candidates[pick] ?? current ?? identities[0];
  const nextIndex = current === chosen && songs[index] ? index : keys.indexOf(chosen);
  return { index: nextIndex, state: createShuffle(songs, nextIndex, state) };
}

export function shufflePrevious(songs: Song[], index: number, previous?: unknown) {
  let state = createShuffle(songs, index, previous);
  if (state.cursor <= 0) return { index, state };
  state = { ...state, cursor: state.cursor - 1 };
  return { index: recordingKeys(songs).keys.indexOf(state.history[state.cursor]), state };
}
