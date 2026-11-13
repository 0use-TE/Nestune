import type { Song } from './types';

export const PLAYBACK_MODES = ['off', 'all', 'one', 'shuffle'] as const;
export type PlaybackMode = typeof PLAYBACK_MODES[number];
export type SharedQueue = { entries: { key: string; song: Song }[]; index: number; mode: PlaybackMode };
export type QueueCommand =
  | { type: 'append' | 'insertNext' | 'playNow'; songId: string }
  | { type: 'replace'; songIds: string[]; index: number; mode?: PlaybackMode }
  | { type: 'remove' | 'jump'; key: string }
  | { type: 'clear' | 'prev' | 'mode' }
  | { type: 'next'; automatic?: boolean; version?: number }
  | { type: 'seek'; position: number };
export type QueueSeed = { ids: string[]; index: number; position: number; playing: boolean; mode: PlaybackMode };

/** Apply commands to the server's current queue, never an older client copy. */
export function changeQueue(queue: SharedQueue, command: QueueCommand, position: number, playing: boolean,
  additions: SharedQueue['entries'] = [], random = Math.random) {
  const next: SharedQueue = { ...queue, entries: [...queue.entries] };
  const previousKey = queue.entries[queue.index]?.key;
  let restart = false;
  switch (command.type) {
    case 'playNow': {
      const existing = next.entries.findIndex(entry => entry.song.id === command.songId);
      if (existing >= 0) next.index = existing;
      else {
        const at = Math.max(0, next.index + 1);
        next.entries.splice(at, 0, ...additions); next.index = at;
      }
      playing = true; restart = true; break;
    }
    case 'replace':
      next.entries = additions; next.index = Math.max(0, Math.min(command.index, additions.length - 1));
      next.mode = command.mode ?? next.mode; playing = true; restart = true; break;
    case 'append': case 'insertNext':
      next.entries.splice(command.type === 'append' ? next.entries.length : Math.max(0, next.index + 1), 0, ...additions);
      if (next.index < 0) { next.index = 0; playing = command.type === 'insertNext'; restart = true; }
      break;
    case 'remove': {
      const at = next.entries.findIndex(entry => entry.key === command.key);
      if (at < 0) return { queue, position, playing };
      next.entries.splice(at, 1);
      if (at < next.index) next.index--;
      else if (at === next.index) { next.index = Math.min(at, next.entries.length - 1); restart = true; }
      break;
    }
    case 'clear': next.entries = []; break;
    case 'jump': {
      const at = next.entries.findIndex(entry => entry.key === command.key);
      if (at < 0) throw new Error('这首歌已移出共同列表');
      next.index = at; playing = true; restart = true; break;
    }
    case 'next':
      if (command.automatic && next.mode === 'one') restart = true;
      else if (next.mode === 'shuffle' && next.entries.length > 1) {
        const pick = Math.floor(random() * (next.entries.length - 1));
        next.index = pick >= next.index ? pick + 1 : pick; restart = true;
      } else if (next.index + 1 < next.entries.length) { next.index++; restart = true; }
      else if (!command.automatic || next.mode === 'all') { next.index = 0; restart = true; }
      else { playing = false; restart = true; }
      if (!command.automatic) playing = true;
      break;
    case 'prev':
      if (position <= 3) next.index = next.index > 0 ? next.index - 1 : next.entries.length - 1;
      restart = true; playing = true; break;
    case 'seek': position = Math.max(0, Math.min(command.position, next.entries[next.index]?.song.duration || 86400)); break;
    case 'mode': next.mode = PLAYBACK_MODES[(PLAYBACK_MODES.indexOf(next.mode) + 1) % PLAYBACK_MODES.length]; break;
  }
  if (!next.entries.length) { next.index = -1; position = 0; playing = false; }
  else if (restart || previousKey !== next.entries[next.index]?.key) position = 0;
  return { queue: next, position, playing };
}
