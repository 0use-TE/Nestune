import type { LyricLine } from './types';

export function parseLrc(text: string) {
  const out: LyricLine[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!content || !tags.length) continue;
    for (const match of tags) {
      out.push({ t: Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number('0.' + match[3]) : 0), text: content });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function formatLrc(lines: LyricLine[]) {
  return lines.filter(line => Number.isFinite(line.t) && line.t >= 0 && line.text.trim()).map(line => {
    const ms = Math.round(line.t * 1000);
    const minutes = String(Math.floor(ms / 60_000)).padStart(2, '0');
    const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    const fraction = String(ms % 1000).padStart(3, '0');
    return `[${minutes}:${seconds}.${fraction}]${line.text.replace(/[\r\n]+/g, ' ')}`;
  }).join('\n');
}
