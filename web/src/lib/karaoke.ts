import type { LyricLine, LyricWord } from './types';

/** Stable within a line/seek; a fresh track seed varies the next listening session. */
export function karaokeFlow(line: Pick<LyricLine, 't' | 'text'>, seed = 0) {
  let hash = (2166136261 ^ seed) >>> 0;
  const key = `${line.t.toFixed(3)}:${line.text}`;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  return { phase: (hash & 65535) / 65536, direction: hash & 65536 ? 1 : -1, speed: 14 + ((hash >>> 17) % 9) };
}

/** Both upstream formats use absolute millisecond word positions. */
export function parseWordLyrics(source: string, format: 'yrc' | 'qrc'): LyricLine[] {
  const text = String(source || '').slice(0, 1_000_000);
  const content = (text.match(/LyricContent="([\s\S]*?)"/)?.[1] || text)
    .replace(/&#(?:10|xA);/gi, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const lines: LyricLine[] = [];
  for (const raw of content.split(/\r?\n/).slice(0, 2400)) {
    const header = /^\[(\d+),(\d+)\](.*)$/.exec(raw.trim());
    if (!header) continue;
    const t = Number(header[1]) / 1000, d = Number(header[2]) / 1000;
    if (!Number.isFinite(t) || t < 0 || t > 86400 || d <= 0 || d > 120) continue;
    const markers = [...header[3].matchAll(format === 'yrc' ? /\((\d+),(\d+),\d+\)/g : /\((\d+),(\d+)\)/g)];
    const words: LyricWord[] = [];
    let valid = true;
    for (const [index, match] of markers.entries()) {
      const wordText = format === 'yrc' ? header[3].slice(match.index! + match[0].length, markers[index + 1]?.index)
        : header[3].slice(index ? markers[index - 1].index! + markers[index - 1][0].length : 0, match.index);
      const word = { t: Number(match[1]) / 1000, d: Number(match[2]) / 1000, text: wordText };
      if (word.t < t - .05 || word.t > t + d + .5 || word.d > 30 || word.t < (words.at(-1)?.t ?? t) || word.text.length > 1024) { valid = false; break; }
      words.push(word);
    }
    const plain = words.map(word => word.text).join('');
    if (valid && words.length && words.length <= 256 && plain.trim() && plain.length <= 2048) lines.push({ t, d, text: plain, words });
  }
  return lines.sort((a, b) => a.t - b.t).slice(0, 1200);
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
/** Preserve real pauses between words; LRC alone can only provide an estimate. */
export function karaokeWords(line: LyricLine, nextTime?: number, duration?: number): LyricWord[] {
  if (line.words?.length && line.words.map(word => word.text).join('') === line.text) return line.words;
  const pieces = [...segmenter.segment(line.text)].map(piece => piece.segment);
  if (!pieces.length) return [];
  const end = line.d ? line.t + line.d : nextTime && nextTime > line.t ? nextTime : duration && duration > line.t ? duration : line.t + 5;
  const length = Math.min(10, Math.max(.2, end - line.t));
  return pieces.map((text, index) => ({ text, t: line.t + length * index / pieces.length, d: length / pieces.length }));
}

export function wordProgress(word: LyricWord, position: number) {
  if (!Number.isFinite(position) || position < word.t) return 0;
  return word.d > 0 ? Math.max(0, Math.min(1, (position - word.t) / word.d)) : 1;
}
