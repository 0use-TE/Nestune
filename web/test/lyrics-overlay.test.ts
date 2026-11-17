import { describe, expect, it } from 'vitest';
import { overlayLine, overlayLyrics } from '../src/lib/overlay-lyrics';
import { playbackVolume } from '../src/lib/volume';

describe('lyrics on a separate clock', () => {
  const data = overlayLyrics('a', 'song', [{ t: 10, text: 'second', tr: '翻译' }, { t: 3, text: 'first' }]);
  it('handles seeking forward, backward, and the exact line boundary', () => {
    expect(overlayLine(data, 'a', 0).text).toBe('前奏');
    expect(overlayLine(data, 'a', 10)).toEqual({ text: 'second', tr: '翻译' });
    expect(overlayLine(data, 'a', 4).text).toBe('first');
    expect(overlayLine(data, 'different-track', 15).text).toBe('正在加载歌词');
  });
  it('bounds native messages and drops invalid timestamps', () => {
    const many = overlayLyrics('a', 'title', Array.from({ length: 3000 }, (_, i) => ({ t: i, text: '长'.repeat(800), tr: '译'.repeat(800) })));
    expect(Buffer.byteLength(JSON.stringify(many), 'utf8')).toBeLessThan(300000);
    expect(many.lines.length).toBeLessThanOrEqual(1200);
    expect(overlayLyrics('a', 'title', [{ t: NaN, text: 'bad' }, { t: -1, text: 'bad' }]).lines).toEqual([]);
  });
  it('honors the translation preference and untimed lyrics', () => {
    expect(overlayLyrics('a', 'title', data.lines, '', false).lines.every(line => !line.tr)).toBe(true);
    expect(overlayLine(overlayLyrics('a', 'title', [], '纯文本歌词'), 'a', 10).text).toBe('纯文本歌词');
  });
});
describe('remembered playback volume', () => {
  it('preserves mute and clamps invalid or out-of-range saved levels', () => {
    expect(playbackVolume('0')).toBe(0);
    expect(playbackVolume('0.35')).toBe(.35);
    expect(playbackVolume('NaN')).toBe(1);
    expect(playbackVolume(null)).toBe(1);
    expect(playbackVolume(-2)).toBe(0);
    expect(playbackVolume(12)).toBe(1);
    expect(playbackVolume(Infinity, .4)).toBe(.4);
  });
});
