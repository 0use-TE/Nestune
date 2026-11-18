export type PaintColor = { hue: number; saturation: number; value: number };

export const PAINT_CARDS = [
  { name: '原版', colors: ['#252422', '#3679d6', '#edaf35', '#dd5961', '#24846b'] },
  { name: '赛博朋克', colors: ['#fcee0a', '#13d9e8', '#fc315d', '#8b55e8', '#171422'] },
  { name: '复古印刷', colors: ['#e3d1a4', '#ca5039', '#e8a444', '#427778', '#302e49'] },
  { name: '夜雾', colors: ['#e7cade', '#ab6da4', '#594b84', '#367a91', '#202337'] },
] as const;

export const PAINT_SCHEMES = [
  { name: '邻近色', offsets: [-38, -19, 0, 19, 38] },
  { name: '互补色', offsets: [0, 0, 0, 180, 180] },
  { name: '分裂互补色', offsets: [0, 0, 150, 210, 210] },
  { name: '三角色', offsets: [0, 120, 240, 120, 240] },
  { name: '单色', offsets: [0, 0, 0, 0, 0] },
] as const;

export function paintRgb({ hue, saturation, value }: PaintColor) {
  const chroma = value * saturation;
  const t = ((hue % 360) + 360) % 360 / 60;
  const mid = chroma * (1 - Math.abs(t % 2 - 1));
  const values = [[chroma, mid, 0], [mid, chroma, 0], [0, chroma, mid],
    [0, mid, chroma], [mid, 0, chroma], [chroma, 0, mid]][Math.floor(t)];
  return values.map(channel => Math.round((channel + value - chroma) * 255));
}

export function paintFromRgb([red, green, blue]: number[], fallbackHue = 0): PaintColor {
  const [r, g, b] = [red, green, blue].map(channel => channel / 255);
  const value = Math.max(r, g, b), diff = value - Math.min(r, g, b);
  if (!diff) return { hue: fallbackHue, saturation: 0, value };
  const hue = 60 * (value === r ? (g - b) / diff : value === g ? (b - r) / diff + 2 : (r - g) / diff + 4);
  return { hue: (hue + 360) % 360, saturation: diff / value, value };
}

export function paintFromHex(hex: string) {
  return paintFromRgb([1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)));
}

export function paintHex(color: PaintColor) {
  return '#' + paintRgb(color).map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export function schemeColors(hue: number, scheme: typeof PAINT_SCHEMES[number]) {
  const tones = [[.27, .98], [.56, .9], [.8, .93], [.7, .68], [.66, .32]];
  return scheme.offsets.map((offset, index) => {
    const [saturation, value] = tones[index];
    return paintHex({ hue: hue + offset, saturation, value });
  });
}

export function randomPaintCard() {
  const scheme = PAINT_SCHEMES[Math.floor(Math.random() * PAINT_SCHEMES.length)];
  return { name: `随机 · ${scheme.name}`, colors: schemeColors(Math.random() * 360, scheme) };
}
