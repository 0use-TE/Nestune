import { inkBounds, type Point } from './canvas-graffiti';

const imageTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
};
export const STENCIL_IMAGE_ACCEPT = Object.keys(imageTypes).map(extension => `.${extension}`).join(',');
export const STENCIL_IMAGE_MAX_SIDE = 1536;
export type StencilImageMode = 'alpha' | 'dark' | 'light';
export type StencilColorLayer = { sample: string; paint: string; hidden?: boolean };
export type StencilPose = { position: Point; rotation: number; size: number };
export type StencilImage = {
  name: string;
  pixels: ImageData;
  mode: StencilImageMode | 'colors';
  threshold: number;
  layers: StencilColorLayer[];
  selected: number;
  range: number;
  background: string | null;
  pose: StencilPose;
};

export async function readStencilImage(file: File): Promise<{ pixels: ImageData; mode: StencilImageMode }> {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const type = Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
  if (!type) throw new Error('请选择 PNG、JPG、WebP、SVG 或 ICO 文件。');
  if (file.size > 8 * 1024 * 1024) throw new Error('模板图片最大支持 8 MB。');
  const url = URL.createObjectURL(file.slice(0, file.size, type));
  try {
    // SVG is decoded as an image and never inserted as markup.
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error('图片没有可读取的尺寸。');
    const scale = Math.min(1, STENCIL_IMAGE_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const mode = defaultStencilImageMode(pixels);
    const bounds = inkBounds(pixels);
    if (!bounds || (bounds.width === pixels.width && bounds.height === pixels.height)) return { pixels, mode };
    return { pixels: context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height), mode };
  } catch {
    throw new Error('无法读取这张图片，请检查文件或换一种格式。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function defaultStencilImageMode({ data }: ImageData): StencilImageMode {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) return 'alpha';
  }
  return 'dark';
}

export function imageStencilMask(source: ImageData, mode: StencilImageMode, threshold: number) {
  const mask = new ImageData(source.width, source.height);
  const { data } = source;
  let hasCutout = false;
  const low = Math.max(0, threshold - 12), high = Math.min(255, threshold + 12);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    const brightness = .2126 * r + .7152 * g + .0722 * b;
    const coverage = mode === 'alpha' ? Math.max(0, Math.min(255, Math.round(255 * (a - low) / (high - low))))
      : a >= 128 && (mode === 'dark' ? brightness <= threshold : brightness >= threshold) ? 255 : 0;
    if (coverage) {
      mask.data[i + 3] = coverage;
      hasCutout = true;
    }
  }
  return hasCutout ? maskCanvas(mask) : null;
}

function maskCanvas(mask: ImageData) {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  canvas.getContext('2d')!.putImageData(mask, 0, 0);
  return canvas;
}

type Lab = [number, number, number];
const linear = Array.from({ length: 256 }, (_, channel) => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
});

function lab(red: number, green: number, blue: number): Lab {
  const r = linear[red], g = linear[green], b = linear[blue];
  const l = Math.cbrt(.41222 * r + .53633 * g + .05145 * b);
  const m = Math.cbrt(.21190 * r + .68070 * g + .10740 * b);
  const s = Math.cbrt(.08830 * r + .28172 * g + .62998 * b);
  return [.21045 * l + .79362 * m - .00407 * s, 1.977998 * l - 2.428592 * m + .450594 * s, .02590 * l + .78277 * m - .80867 * s];
}

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255] as const;
}

function distance(l: number, a: number, b: number, target: Lab) {
  return (l - target[0]) ** 2 + 3 * ((a - target[1]) ** 2 + (b - target[2]) ** 2);
}

const labCache = new WeakMap<ImageData, Float32Array>();
function sourceLab(source: ImageData) {
  const cached = labCache.get(source);
  if (cached) return cached;
  const pixels = new Float32Array(source.width * source.height * 3);
  for (let i = 0, j = 0; i < source.data.length; i += 4, j += 3) {
    if (source.data[i + 3] >= 128) pixels.set(lab(source.data[i], source.data[i + 1], source.data[i + 2]), j);
  }
  labCache.set(source, pixels);
  return pixels;
}

export function autoStencilLayers(source: ImageData, count: number): StencilColorLayer[] {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  const { data } = source;
  const step = Math.max(1, Math.floor(source.width * source.height / 12000)) | 1;
  for (let i = 0; i < data.length; i += step * 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
    buckets.set(key, bucket);
  }
  const samples = [...buckets.values()].map(({ r, g, b, count: weight }) => {
    const channels = [r, g, b].map(sum => Math.round(sum / weight)) as [number, number, number];
    return { channels, color: lab(...channels), weight };
  }).sort((a, b) => b.weight - a.weight);
  if (!samples.length) return [];
  const centers = [samples[0].color];
  while (centers.length < Math.min(count, samples.length)) {
    let best = samples[0].color, score = -1;
    for (const sample of samples) {
      const difference = Math.min(...centers.map(center => distance(...sample.color, center))) * Math.sqrt(sample.weight);
      if (difference > score) { score = difference; best = sample.color; }
    }
    centers.push(best);
  }
  let groups: { sums: number[]; weight: number }[] = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    groups = centers.map(() => ({ sums: [0, 0, 0], weight: 0 }));
    for (const { channels, color, weight } of samples) {
      let index = 0, nearest = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const difference = distance(...color, centers[i]);
        if (difference < nearest) { index = i; nearest = difference; }
      }
      const group = groups[index];
      group.weight += weight;
      for (let i = 0; i < 3; i++) group.sums[i] += channels[i] * weight;
    }
    groups.forEach(({ sums, weight }, index) => {
      if (weight) centers[index] = lab(Math.round(sums[0] / weight), Math.round(sums[1] / weight), Math.round(sums[2] / weight));
    });
  }
  return groups.filter(group => group.weight).sort((a, b) => b.weight - a.weight).map(({ sums, weight }) => {
    const hex = '#' + sums.map(sum => Math.round(sum / weight).toString(16).padStart(2, '0')).join('');
    return { sample: hex, paint: hex };
  });
}

export function separateStencilColors(source: ImageData, samples: readonly string[], range: number, background: string | null) {
  const colors = samples.map(hex => lab(...rgb(hex)));
  const ignored = background ? lab(...rgb(background)) : null;
  const values = sourceLab(source);
  const assignments = new Uint8Array(source.width * source.height);
  const limit = range === 100 ? Infinity : (range / 130) ** 2;
  for (let i = 0, j = 0; i < assignments.length; i++, j += 3) {
    if (source.data[i * 4 + 3] < 128) continue;
    const l = values[j], a = values[j + 1], b = values[j + 2];
    let best = ignored ? Math.min(limit, distance(l, a, b, ignored)) : limit;
    for (let layer = 0; layer < colors.length; layer++) {
      const error = distance(l, a, b, colors[layer]);
      if (error < best) {
        best = error;
        assignments[i] = layer + 1;
      }
    }
  }
  return assignments;
}

export function stencilColorMask(source: ImageData, assignments: Uint8Array, selected: number) {
  const mask = new ImageData(source.width, source.height);
  let hasCutout = false;
  for (let i = 0; i < assignments.length; i++) {
    if (assignments[i] !== selected + 1) continue;
    mask.data[i * 4 + 3] = 255;
    hasCutout = true;
  }
  return hasCutout ? maskCanvas(mask) : null;
}

export function stencilColorPreview(source: ImageData, assignments: Uint8Array, layers: StencilColorLayer[]) {
  const output = new ImageData(source.width, source.height);
  const colors = layers.map(layer => layer.hidden ? null : [...rgb(layer.paint), 255]);
  for (let i = 0; i < assignments.length; i++) {
    const color = colors[assignments[i] - 1];
    if (color) output.data.set(color, i * 4);
  }
  return output;
}
