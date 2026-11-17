import type { LyricLine } from './types';

export type OverlayData = { type: 'lyricsData'; id: string; title: string; lines: LyricLine[]; plainText: string };
export type OverlayMedia = { type: 'lyricsMedia'; id: string; position: number; playing: boolean };
export function overlayLyrics(id: string, title: string, lines: LyricLine[], plainText = '', translation = true): OverlayData {
  let remaining = 60000;
  const safe = lines.filter(line => Number.isFinite(line.t) && line.t >= 0 && line.t <= 86400).slice(0, 1200).sort((a, b) => a.t - b.t).flatMap(line => {
    const text = line.text.slice(0, 256), tr = translation ? line.tr?.slice(0, 256) : undefined;
    remaining -= text.length + (tr?.length || 0) + 40;
    return remaining >= 0 ? [{ t: line.t, text, ...(tr ? { tr } : {}) }] : [];
  });
  return { type: 'lyricsData', id: id.slice(0, 160), title: title.slice(0, 256), lines: safe, plainText: plainText.slice(0, 2048) };
}

export function overlayLine(data: OverlayData | null, id: string, position: number): { text: string; tr: string } {
  if (!data || data.id !== id) return { text: '正在加载歌词', tr: '' };
  let low = 0, high = data.lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if (data.lines[middle].t <= position) low = middle + 1; else high = middle; }
  const line = data.lines[low - 1];
  return { text: line?.text || (data.lines.length ? '前奏' : data.plainText.split('\n').find(Boolean) || '暂无歌词'), tr: line?.tr || '' };
}
