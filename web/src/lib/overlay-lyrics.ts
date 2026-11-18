import type { LyricLine } from './types';
import type { PlaybackMode } from './shared-queue';

export type OverlayData = { type: 'lyricsData'; id: string; title: string; lines: LyricLine[]; plainText: string; flowSeed?: number; duration?: number };
export type OverlayMedia = { type: 'lyricsMedia'; id: string; position: number; playing: boolean; mode?: PlaybackMode };
export function overlayLyrics(id: string, title: string, lines: LyricLine[], plainText = '', translation = true, flowSeed = 0, duration = 0): OverlayData {
  let remaining = 240000;
  const encoder = new TextEncoder();
  const safe = lines.filter(line => Number.isFinite(line.t) && line.t >= 0 && line.t <= 86400).slice(0, 1200).sort((a, b) => a.t - b.t).flatMap(line => {
    const text = line.text.slice(0, 256), tr = translation ? line.tr?.slice(0, 256) : undefined;
    const words = line.words?.length && line.words.length <= 128 && line.words.map(word => word.text).join('') === text
      && line.words.every(word => Number.isFinite(word.t) && Number.isFinite(word.d) && word.t >= line.t && word.t <= 86400 && word.d >= 0 && word.d <= 120)
      ? line.words.map(word => ({ t: word.t, d: word.d, text: word.text })) : undefined;
    const value: LyricLine = { t: line.t, text, ...(tr ? { tr } : {}), ...(words ? { words } : {}),
      ...(Number.isFinite(line.d) && line.d! > 0 && line.d! <= 120 ? { d: line.d } : {}) };
    remaining -= encoder.encode(JSON.stringify(value)).length + 1;
    return remaining >= 0 ? [value] : [];
  });
  return { type: 'lyricsData', id: id.slice(0, 160), title: title.slice(0, 256), lines: safe, plainText: plainText.slice(0, 2048),
    ...(flowSeed ? { flowSeed: flowSeed >>> 0 } : {}), ...(Number.isFinite(duration) && duration > 0 && duration <= 86400 ? { duration } : {}) };
}

export function overlayCurrent(data: OverlayData | null, id: string, position: number) {
  if (!data || data.id !== id) return null;
  let low = 0, high = data.lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if (data.lines[middle].t <= position) low = middle + 1; else high = middle; }
  return data.lines[low - 1] ? { line: data.lines[low - 1], nextTime: data.lines[low]?.t } : null;
}

export function overlayLine(data: OverlayData | null, id: string, position: number): { text: string; tr: string } {
  if (!data || data.id !== id) return { text: '正在加载歌词', tr: '' };
  let low = 0, high = data.lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if (data.lines[middle].t <= position) low = middle + 1; else high = middle; }
  const line = data.lines[low - 1];
  return { text: line?.text || (data.lines.length ? '前奏' : data.plainText.split('\n').find(Boolean) || '暂无歌词'), tr: line?.tr || '' };
}
