export const mmss = (n: number) => {
  if (!Number.isFinite(n) || n < 0) n = 0;
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
};
export const fmtBytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
export const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString('zh-CN') : '—');
export const fmtDateTime = (t: number) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');
export const fmtCount = (n?: number) => (!n ? '' : n >= 1e8 ? `${(n / 1e8).toFixed(1)} 亿` : n >= 1e4 ? `${Math.round(n / 1e4)} 万` : String(n));
export const QUALITY_LABEL: Record<string, string> = { standard: '标准', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' };
export const greet = () => {
  const h = new Date().getHours();
  return h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
};

export const PAL = [['#1f3a4d', '#3d6b7d', '#f2b84b'], ['#c8553d', '#e8895f', '#fbe3c4'], ['#3b3f6b', '#6b6fb0', '#f4c9d6'], ['#2d5d4b', '#5f9a7f', '#f0e6b8'], ['#5a2e4e', '#9a4f7d', '#f7c59f'], ['#b5812b', '#d9a441', '#fff6dc'], ['#22252b', '#454b57', '#e9e4d8'], ['#a45a5a', '#c97b7b', '#f6ddd2']];
export const hashSeed = (s: string | number) => {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};
export const SHAPES: ((c: string) => string)[] = [
  c => `<circle cx="62" cy="40" r="22" fill="${c}"/><path d="M0 70h100v30H0z" fill="#000" opacity=".16"/><path d="M0 82h100v18H0z" fill="#000" opacity=".16"/>`,
  c => `<circle cx="50" cy="108" r="74" fill="${c}" opacity=".35"/><circle cx="50" cy="108" r="52" fill="${c}" opacity=".55"/><circle cx="50" cy="108" r="30" fill="${c}"/>`,
  c => `<path d="M-10 40 60-30l30 0L-10 70z" fill="${c}" opacity=".9"/><path d="M20 110 110 20v40L60 110z" fill="#000" opacity=".14"/>`,
  c => `<circle cx="38" cy="50" r="30" fill="${c}" opacity=".85"/><circle cx="64" cy="50" r="30" fill="#000" opacity=".18"/><circle cx="82" cy="20" r="7" fill="${c}"/>`,
  c => `<rect x="18" y="18" width="64" height="64" rx="32" fill="${c}"/><rect x="38" y="38" width="64" height="64" rx="32" fill="#000" opacity=".16"/>`,
  c => `<path d="M0 60Q25 30 50 60T100 60V100H0z" fill="${c}" opacity=".9"/><path d="M0 78Q25 52 50 78T100 78V100H0z" fill="#000" opacity=".14"/><circle cx="72" cy="28" r="12" fill="${c}"/>`,
];

/** Dominant colour of a cover image, darkened so white text stays readable. Falls back to a seeded palette. */
const tints = new Map<string, [string, string]>();
export function seededTint(seed: string | number): [string, string] {
  const p = PAL[hashSeed(seed) % PAL.length];
  return [p[0], p[1]];
}
export function loadTint(src: string | null | undefined, seed: string | number): Promise<[string, string]> {
  const key = src || `seed:${seed}`;
  const hit = tints.get(key);
  if (hit) return Promise.resolve(hit);
  const fallback = seededTint(seed);
  if (!src || typeof window === 'undefined') return Promise.resolve(fallback);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 24;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const wt = 0.15 + (mx - mn) / 255; // favour saturated pixels
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        const base = [r / w, g / w, b / w];
        const lum = (x: number[]) => (0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]) / 255;
        const dark = (x: number[], max: number) => { const l = lum(x); const k = l > max ? max / l : 1; return x.map(v => Math.round(v * k)); };
        const hex = (x: number[]) => '#' + x.map(v => v.toString(16).padStart(2, '0')).join('');
        const out: [string, string] = [hex(dark(base, 0.42)), hex(dark(base.map(v => v * 0.6), 0.25))];
        tints.set(key, out); resolve(out);
      } catch { tints.set(key, fallback); resolve(fallback); }
    };
    img.onerror = () => { tints.set(key, fallback); resolve(fallback); };
    img.src = src;
  });
}

const ORDER = ['standard', 'exhigh', 'lossless', 'hires'];
const FORMAT: Record<string, string> = { standard: 'MP3', exhigh: 'MP3', lossless: 'FLAC', hires: 'FLAC' };
/** Best quality this user can get for a song, from catalog data already in the list (no extra request). */
export function bestTier(song: { qualities?: { level: string; size?: number }[]; access?: { playable: boolean; max: string | null } }, cap: string) {
  if (!song.qualities?.length || song.access?.playable === false) return null;
  const limit = Math.min(ORDER.indexOf(cap), song.access?.max ? ORDER.indexOf(song.access.max) : 3);
  for (let i = Math.min(limit, 3); i >= 0; i--) {
    const q = song.qualities.find(x => x.level === ORDER[i]);
    if (q) return { level: ORDER[i], label: QUALITY_LABEL[ORDER[i]], format: FORMAT[ORDER[i]], size: q.size ?? 0 };
  }
  return null;
}
export const unplayableText = (reason?: string) => (reason && reason.includes('版权') ? '暂无版权' : '无播放权限');
