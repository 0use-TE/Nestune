import { expect, it } from 'vitest';
import type { Song } from '@/lib/types';
import { createShuffle, readShuffle, shuffleNext, shufflePrevious } from '@/lib/shuffle';
import { changeQueue, type SharedQueue } from '@/lib/shared-queue';

const song = (id: string, canonicalId?: string): Song => ({ id, canonicalId, name: id, artists: [], album: { id: null, name: '' }, duration: 200, cover: null });
const songs = ['1','2','3','4','5','6'].map(id => song(id));
it.each([0, .25, .99])('visits every recording once per round and never repeats at the boundary, even with RNG %s', draw => {
  let index = 0, state = createShuffle(songs, index); const played = [songs[index].id];
  for (let i = 0; i < songs.length * 20 - 1; i++) {
    const pick = shuffleNext(songs, index, state, () => draw); index = pick.index; state = pick.state; played.push(songs[index].id);
  }
  for (let i = 0; i < played.length; i += songs.length) expect(new Set(played.slice(i, i + songs.length)).size).toBe(songs.length);
  expect(played.every((id, i) => !i || id !== played[i - 1])).toBe(true);
});
it('deduplicates duplicate queue slots and known source aliases without folding different recordings', () => {
  const queue = [song('1'), song('1'), song('qq-one','1'), song('2'), song('3')];
  let state = createShuffle(queue, 1), index = 1; const played = [queue[index].canonicalId || queue[index].id];
  for (let i = 0; i < 2; i++) { const pick = shuffleNext(queue, index, state, () => 0); state = pick.state; index = pick.index; played.push(queue[index].canonicalId || queue[index].id); }
  expect(played).toEqual(['1','2','3']);
});
it('prioritizes appended songs, prunes removed identities and survives index changes', () => {
  let state = createShuffle(songs, 0); const first = shuffleNext(songs, 0, state, () => 0); state = first.state;
  const changed = [songs[1], songs[2], song('9')];
  const pick = shuffleNext(changed, 0, state, () => .99);
  expect(changed[pick.index].id).toBe('9'); expect(pick.state.seen).not.toContain('1');
});
it('uses actual playback history for previous and forward, and branches on an explicit selection', () => {
  const first = shuffleNext(songs, 0, undefined, () => .99), second = shuffleNext(songs, first.index, first.state, () => 0);
  const back = shufflePrevious(songs, second.index, second.state); expect(back.index).toBe(first.index);
  const forward = shuffleNext(songs, back.index, back.state, () => { throw Error('Forward history must not draw again'); }); expect(forward.index).toBe(second.index);
  const manual = createShuffle(songs, 3, back.state); expect(manual.history.at(-1)).toBe('4'); expect(manual.history).not.toContain(songs[second.index].id);
  expect(shuffleNext(songs, 3, manual, () => 0).index).not.toBe(3);
});
it('continues the same round after JSON persistence and a source identity merge', () => {
  const first = shuffleNext(songs, 0, undefined, () => 0);
  const merged = [song('qq-a','1'), ...songs.slice(1)]; merged[0].sources = [{ id: '1', provider: 'netease' }, { id: 'qq-a', provider: 'qq' }];
  const state = createShuffle(merged, first.index, JSON.parse(JSON.stringify(first.state)));
  expect(shuffleNext(merged, first.index, state, () => 0).index).toBe(2);
});
it('reconciles a stale duplicate row when another row already knows the shared source alias', () => {
  const ne = song('1'); ne.sources = [{ id:'1', provider:'netease' }, { id:'qq-old', provider:'qq' }];
  const queue = [ne, song('qq-old','qq-old'), song('2')];
  expect(shuffleNext(queue, 0, undefined, () => 0).index).toBe(2);
});
it('handles empty, single-recording duplicates, old state and untrusted saved data', () => {
  expect(shuffleNext([], -1).index).toBe(-1);
  expect(shuffleNext([song('1'),song('1')], 1, undefined, () => .99).index).toBe(1);
  expect(shufflePrevious(songs, 0).index).toBe(0);
  const restored = readShuffle({ seen: [...Array(700).fill('1'), null, 4], history: Array(700).fill('1'), cursor: 699 });
  expect(restored.seen).toEqual(['1']); expect(restored.history).toHaveLength(500); expect(restored.cursor).toBe(499);
  expect(readShuffle(null)).toEqual({ seen: [], history: [], cursor: -1 });
});
it('does not forget the start of a large in-memory queue before the round finishes', () => {
  const many = Array.from({ length: 550 }, (_, i) => song(String(i + 1)));
  let index = 0, state = createShuffle(many, 0); const played = new Set([many[0].id]);
  for (let i = 1; i < many.length; i++) { const pick = shuffleNext(many, index, state, () => 0); index = pick.index; state = pick.state; expect(played.has(many[index].id)).toBe(false); played.add(many[index].id); }
  expect(played.size).toBe(many.length);
  const smaller = many.slice(0, 500);
  const nextRound = shuffleNext(smaller, -1, state, () => .999);
  expect(nextRound.index).toBe(499);
  expect(nextRound.state.seen).toEqual(['500']);
});
it('keeps server-owned shared shuffle immutable, with independent state per queue', () => {
  let queue: SharedQueue = { entries: songs.map((s,i) => ({ key: String(i), song: s })), index: 0, mode: 'shuffle' };
  const original = JSON.stringify(queue), played = ['1'];
  for (let i = 1; i < songs.length; i++) { const result = changeQueue(queue, { type:'next', automatic:true }, 199, true, [], () => 0); if(i===1) expect(JSON.stringify(queue)).toBe(original); queue = result.queue; played.push(queue.entries[queue.index].song.id); }
  expect(new Set(played).size).toBe(songs.length);
  const previous = changeQueue(queue, {type:'prev'}, 0, true).queue; expect(previous.entries[previous.index].song.id).toBe('5');
  expect(changeQueue(queue, {type:'prev'}, 20, true).queue.index).toBe(queue.index);
  const independent = changeQueue({ ...queue, index:0, shuffle:undefined }, {type:'next'}, 0, true, [], () => 0).queue;
  expect(independent.entries[independent.index].song.id).toBe('2');
});
