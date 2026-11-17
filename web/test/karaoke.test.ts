import { describe, expect, it } from 'vitest';
import { karaokeFlow, karaokeWords, parseWordLyrics, wordProgress } from '@/lib/karaoke';

describe('real word timing', () => {
  it('parses absolute YRC timing, including rests and parentheses in text', () => {
    const [line] = parseWordLyrics('[1000,4000](1000,500,0)你(2500,1500,0)(hello)', 'yrc');
    expect(line).toEqual({ t: 1, d: 4, text: '你(hello)', words: [{ t: 1, d: .5, text: '你' }, { t: 2.5, d: 1.5, text: '(hello)' }] });
    expect(wordProgress(line.words![0], 2)).toBe(1);
    expect(wordProgress(line.words![1], 2)).toBe(0);
    expect(wordProgress(line.words![1], 3.25)).toBe(.5);
  });
  it('parses QQ QRC payloads with XML attributes and escaped newlines', () => {
    const lines = parseWordLyrics('<Lyric_1 LyricContent="[1000,2000]你(1000,800)好(1800,1200)&#10;[5000,1000]风(5000,1000)"/>', 'qrc');
    expect(lines.map(line => line.text)).toEqual(['你好', '风']);
    expect(lines[0].words![1]).toEqual({ t: 1.8, d: 1.2, text: '好' });
  });
  it('rejects impossible or descending timings instead of showing an incorrect sweep', () => {
    expect(parseWordLyrics('[1000,4000](2000,300,0)你(1500,100,0)好\n[1000,3000](99999999,1,0)坏', 'yrc')).toEqual([]);
  });
  it('handles exact boundaries, zero duration, and seeking backward', () => {
    const word = { t: 10, d: 2, text: '唱' };
    expect([9, 10, 11, 12, 30, 9].map(time => wordProgress(word, time))).toEqual([0, 0, .5, 1, 1, 0]);
    expect(wordProgress({ ...word, d: 0 }, 10)).toBe(1);
    expect(wordProgress(word, NaN)).toBe(0);
  });
});
describe('line-only fallback', () => {
  it('keeps combined characters and emoji intact without inventing precise timing', () => {
    const words = karaokeWords({ t: 3, text: '你👨‍👩‍👦é' }, 6);
    expect(words.map(word => word.text)).toEqual(['你', '👨‍👩‍👦', 'é']);
    expect(words.map(word => word.t)).toEqual([3, 4, 5]);
  });
  it('does not stretch the last word over a long instrumental gap', () => {
    const words = karaokeWords({ t: 2, text: '再见' }, 100);
    expect(words.at(-1)!.t + words.at(-1)!.d).toBe(12);
    expect(karaokeWords({ t: 2, text: '再见' }, undefined, 6).at(-1)!.t).toBe(4);
  });
});

describe('varied but seek-stable color flow', () => {
  it('varies the phase and direction by line and listening seed without flickering', () => {
    const line = { t: 12.4, text: '让音乐慢慢流过' };
    expect(karaokeFlow(line, 123)).toEqual(karaokeFlow(line, 123));
    expect(karaokeFlow(line, 124)).not.toEqual(karaokeFlow(line, 123));
    const flows = Array.from({ length: 50 }, (_, t) => karaokeFlow({ ...line, t }, 123));
    expect(new Set(flows.map(flow => flow.phase)).size).toBe(50);
    expect(new Set(flows.map(flow => flow.direction))).toEqual(new Set([-1, 1]));
    expect(flows.every(flow => flow.phase >= 0 && flow.phase < 1 && flow.speed >= 14 && flow.speed <= 22)).toBe(true);
  });
});
