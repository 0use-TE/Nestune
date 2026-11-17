import { expect, it } from 'vitest';
import { rankSearchSongs } from '@/lib/search-ranking';
import { mergeSongPages } from '@/lib/music-ids';
import type { Song } from '@/lib/types';

const song = (id: string, artist = '周杰伦', name = '青花瓷', album = '我很忙'): Song => ({
  id, name, artists: [{ id: artist, name: artist }], album: { id: album || null, name: album }, duration: 240, cover: null,
});
it('puts the QQ top result ahead of the preceding 30 NetEase results for the reported search', () => {
  const ne = [song('1', '刘芳', '青花瓷', '再醉一次.精选二'),
    ...Array.from({ length: 29 }, (_, i) => song(String(i + 2), '翻唱歌手', '青花瓷 (DJ版)'))];
  const qq = [song('qq-original'), song('qq-live', '周杰伦', '青花瓷', '魔天伦世界巡回演唱会')];
  const items = [...ne, ...qq];
  expect(rankSearchSongs('青花瓷', items, [ne, qq])[0].id).toBe('qq-original');
  expect(rankSearchSongs('青花瓷', [...qq, ...ne], [qq, ne]).map(s => s.id))
    .toEqual(rankSearchSongs('青花瓷', items, [ne, qq]).map(s => s.id));
});
it('prioritizes actual artist metadata instead of an original-singer credit in a title', () => {
  const credited = song('1', '钢琴演奏者', '青花瓷 (原唱：周杰伦)');
  const original = song('qq-original');
  for (const query of ['青花瓷 周杰伦', '周杰伦青花瓷'])
    expect(rankSearchSongs(query, [credited, original], [[credited], [original]])[0].id).toBe(original.id);
});
it.each([
  ['现场', '青花瓷', '魔天伦世界巡回演唱会'],
  ['伴奏', '青花瓷 (伴奏)', '伴奏专辑'],
  ['DJ', '青花瓷 (DJ版)', 'DJ舞曲'],
])('respects an explicitly requested %s version', (query, name, album) => {
  const studio = song('1'), variant = song('qq-variant', '周杰伦', name, album);
  expect(rankSearchSongs('青花瓷', [variant, studio], [[studio], [variant]])[0].id).toBe(studio.id);
  expect(rankSearchSongs(`青花瓷 ${query}`, [studio, variant], [[studio], [variant]])[0].id).toBe(variant.id);
});
it('ranks uploads by relevance, without a fixed local-first rule', () => {
  const upload = song('up-example', '其他歌手', '青花瓷 (伴奏)'), online = song('qq-original');
  expect(rankSearchSongs('青花瓷', [upload, online], [[online]])[0].id).toBe(online.id);
  expect(rankSearchSongs('青花瓷 其他歌手', [online, upload], [[online]])[0].id).toBe(upload.id);
});
it('retains both providers rank evidence for an already merged recording', () => {
  const a = song('1'), b = { ...song('qq-same'), canonicalId: '1' };
  const rival = song('2');
  const merged = mergeSongPages([], [a, b, rival]);
  expect(merged).toHaveLength(2);
  expect(rankSearchSongs('青花瓷', merged, [[rival, a], [b]])[0].id).toBe('1');
});
it('keeps loaded pages stable when appending a reranked page', () => {
  const first = [song('1'), song('qq-a')];
  const second = rankSearchSongs('青花瓷', [song('2'), song('qq-b')], [[song('2')], [song('qq-b')]], 30);
  expect(mergeSongPages(first, second).slice(0, 2).map(s => s.id)).toEqual(['1', 'qq-a']);
});
