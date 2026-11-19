export const MAX_GRAFFITI_SIDE = 1280;
export const GRAFFITI_PNG_MAX_BYTES = 3 * 1024 * 1024;
export const MAX_GRAFFITI_WORLD_WIDTH = 40_000;
export const GRAFFITI_TEXT_LIMIT = 18;

export const GRAFFITI_STENCILS = [
  { id: 'crown', label: '歪皇冠', path: 'M9 34 34 49 45 12 60 43 91 18 81 67 22 79ZM20 85 83 73 85 83 24 96Z' },
  { id: 'boombox', label: '街头音箱', path: 'M28 29V18Q28 13 34 13H66Q72 13 72 18V29H93Q97 29 97 34V84H3V34Q3 29 7 29ZM35 29H65V20H35ZM12 58a14 14 0 1 0 28 0 14 14 0 1 0-28 0Zm6 0a8 8 0 1 1 16 0 8 8 0 1 1-16 0Zm42 0a14 14 0 1 0 28 0 14 14 0 1 0-28 0Zm6 0a8 8 0 1 1 16 0 8 8 0 1 1-16 0ZM45 44H55V50H45ZM45 56H55V61H45Z' },
  { id: 'spray', label: '喷漆罐', path: 'M34 23H64V33L74 39V88Q74 94 68 94H30Q24 94 24 88V39L34 33ZM40 8H57V19H40ZM66 9H72V15H66ZM77 4H84V10H77ZM79 15H88V21H79ZM89 8H97V14H89ZM53 42 34 65H47L43 83 63 59H50Z' },
  { id: 'arrow', label: '野式箭头', path: 'M3 59 39 34 35 51 59 42 49 25 94 21 82 68 70 55 34 70 40 55 6 70ZM10 78 47 77 33 89 6 88ZM57 75 68 69 62 88 51 91Z' },
  { id: 'drip', label: '流漆印', path: 'M7 19Q18 7 37 16 49 7 60 17 77 9 93 26 102 42 82 48V65Q75 76 72 64V48L65 49V84Q63 95 57 85V50L48 52V67Q45 77 39 70V51L29 49V89Q26 99 20 90V46Q0 40 7 19Z' },
  { id: 'deck', label: '滑板', path: 'M12 30Q5 25 7 17L17 25Q22 29 29 29H71Q79 29 84 24L94 16Q97 25 90 31L81 43H20ZM24 50a10 10 0 1 0 20 0H24ZM60 50a10 10 0 1 0 20 0H60ZM18 79 60 68 56 75 86 69 76 81 25 89 31 81 14 85Z' },
] as const;

export type TextShape = { width: number; height: number; slant: number; tracking: number };
export const TEXT_SHAPES = [
  { label: '高挑', shape: { width: 0.75, height: 2.2, slant: 0, tracking: 0 } },
  { label: '宽扁', shape: { width: 1.25, height: 0.72, slant: 0, tracking: 0.02 } },
  { label: '斜冲', shape: { width: 0.95, height: 1.28, slant: 18, tracking: -0.025 } },
] as const;
export const DEFAULT_TEXT_SHAPE: TextShape = { width: 1, height: 1, slant: 0, tracking: 0 };
export const ROAD_RAGE_SHAPE: TextShape = { width: 1.12, height: 0.86, slant: 16, tracking: -0.035 };
const chineseFonts = ['Ma Shan Zheng', 'ZCOOL QingKe HuangYou'] as const;
export const GRAFFITI_FONTS = ['Road Rage', 'Pirata One', 'Permanent Marker', 'Black Ops One', 'Rubik Glitch', ...chineseFonts] as const;
export type GraffitiFont = typeof GRAFFITI_FONTS[number];
export const GRAFFITI_FONT_LABELS: Partial<Record<GraffitiFont, string>> = {
  'Ma Shan Zheng': '马善政楷书',
  'ZCOOL QingKe HuangYou': '站酷庆科黄油体',
};
export type GraffitiPass = 'fill' | 'offset' | 'outline';
export type GraffitiStencil = { type: 'shape'; path: string }
  | { type: 'image'; mask: HTMLCanvasElement | null }
  | { type: 'text'; text: string; font: GraffitiFont; pass: GraffitiPass };
export type TextEffects = { distance: number; angle: number; outlineWidth: number; wrapShadow: boolean };
export const DEFAULT_TEXT_EFFECTS: TextEffects = { distance: 7, angle: 65, outlineWidth: 4, wrapShadow: true };
export type Point = { x: number; y: number };
export type GraffitiArea = Point & { width: number; height: number; rasterWidth: number; rasterHeight: number };
export type GraffitiPlacement = Point & { width: number };

export function stencilText(font: GraffitiFont, text: string) {
  return font === 'Road Rage' || font === 'Permanent Marker' ? text.toUpperCase() : text;
}

export function stencilFontNeedsFallback(font: GraffitiFont, text: string) {
  return !(chineseFonts as readonly string[]).includes(font) && /\p{Script=Han}/u.test(text);
}

export function stencilFontFamily(font: GraffitiFont, text: string) {
  return `"${font}"${stencilFontNeedsFallback(font, text) ? ', "Ma Shan Zheng"' : ''}, sans-serif`;
}

export function extendGraffitiArea(area: GraffitiArea, view: GraffitiArea): GraffitiArea | null {
  const x = Math.min(area.x, view.x), y = Math.min(area.y, view.y);
  const width = Math.max(area.x + area.width, view.x + view.width) - x;
  const height = Math.max(area.y + area.height, view.y + view.height) - y;
  if (width > MAX_GRAFFITI_WORLD_WIDTH || height > MAX_GRAFFITI_WORLD_WIDTH) return null;
  if (x === area.x && y === area.y && width <= area.width + .001 && height <= area.height + .001) return area;
  const density = Math.min(Math.max(area.rasterWidth, area.rasterHeight) / Math.max(area.width, area.height), MAX_GRAFFITI_SIDE / Math.max(width, height));
  return { x, y, width, height, rasterWidth: Math.max(1, Math.round(width * density)), rasterHeight: Math.max(1, Math.round(height * density)) };
}

export function cutStencil(context: CanvasRenderingContext2D, stencil: GraffitiStencil, center: Point, size: number,
  shape: TextShape, effects: TextEffects, rotation: number, fitArea: { width: number; height: number },
) {
  const { width: canvasWidth, height: canvasHeight } = context.canvas;
  const tilt = rotation * Math.PI / 180;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  context.translate(center.x, center.y);
  context.rotate(tilt);
  context.fillStyle = '#fff';
  if (stencil.type === 'shape') {
    context.scale(size / 100, size / 100);
    context.translate(-50, -50);
    context.fill(new Path2D(stencil.path), 'evenodd');
  } else if (stencil.type === 'image') {
    if (stencil.mask) {
      const { width, height } = stencil.mask;
      const scale = size / Math.max(width, height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(stencil.mask, -width * scale / 2, -height * scale / 2, width * scale, height * scale);
    }
  } else {
    const text = stencilText(stencil.font, stencil.text);
    const fontSize = Math.max(1, size * (stencil.font === 'Pirata One' ? 0.38 : 0.52));
    context.font = `${fontSize}px ${stencilFontFamily(stencil.font, text)}`;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    const metrics = context.measureText(text);
    const glyphs = [...text].map(char => ({ char, width: context.measureText(char).width }));
    const tracking = shape.tracking * fontSize;
    const width = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + tracking * (glyphs.length - 1);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const baseScale = Math.min(1, size / Math.max(1, width));
    const shear = Math.tan(shape.slant * Math.PI / 180);
    const adjustedHeight = height * baseScale * shape.height;
    const adjustedWidth = width * baseScale * shape.width + Math.abs(shear) * adjustedHeight;
    const cos = Math.abs(Math.cos(tilt)), sin = Math.abs(Math.sin(tilt));
    const fit = Math.min(1, fitArea.width * 0.90 / (cos * adjustedWidth + sin * adjustedHeight),
      fitArea.height * 0.82 / (sin * adjustedWidth + cos * adjustedHeight));
    const scaleX = baseScale * shape.width * fit, scaleY = baseScale * shape.height * fit;
    context.transform(scaleX, 0, -shear * scaleY, scaleY, 0, 0);
    const baseline = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    const drawText = (dx: number, dy: number, stroke = false) => {
      let x = -width / 2 + dx;
      for (const glyph of glyphs) {
        if (stroke) context.strokeText(glyph.char, x, baseline + dy);
        else context.fillText(glyph.char, x, baseline + dy);
        x += glyph.width + tracking;
      }
    };
    if (stencil.pass === 'fill') {
      drawText(0, 0);
    } else {
      const angle = effects.angle * Math.PI / 180;
      const distance = fontSize * effects.distance / 100;
      const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
      if (stencil.pass === 'outline') {
        context.lineWidth = fontSize * effects.outlineWidth / 100;
        context.lineJoin = 'round';
        context.strokeStyle = '#fff';
        drawText(0, 0, true);
        if (effects.wrapShadow) drawText(dx, dy, true);
      } else {
        drawText(dx, dy);
      }
      context.globalCompositeOperation = 'destination-out';
      if (stencil.pass === 'outline' && effects.wrapShadow) drawText(dx, dy);
      drawText(0, 0);
    }
  }
  context.restore();
}

/** Turn the cutout into a blocker with a soft edge on the rotated image boundary. */
export function blockImageStencilInterior(
  mask: CanvasRenderingContext2D, center: Point, width: number, height: number, rotation: number, feather: number,
) {
  function fade(gradient: CanvasGradient, length: number) {
    const edge = Math.min(.25, feather / length);
    gradient.addColorStop(0, '#fff0');
    gradient.addColorStop(edge, '#fff');
    gradient.addColorStop(1 - edge, '#fff');
    gradient.addColorStop(1, '#fff0');
    return gradient;
  }
  const x = -width / 2, y = -height / 2;
  mask.save();
  mask.translate(center.x, center.y);
  mask.rotate(rotation * Math.PI / 180);
  mask.globalCompositeOperation = 'source-out';
  mask.fillStyle = fade(mask.createLinearGradient(x, 0, -x, 0), width);
  mask.fillRect(x, y, width, height);
  mask.globalCompositeOperation = 'destination-in';
  mask.fillStyle = fade(mask.createLinearGradient(0, y, 0, -y), height);
  mask.fillRect(x, y, width, height);
  mask.restore();
}

export function sprayPaint(
  paint: CanvasRenderingContext2D, scratch: CanvasRenderingContext2D, paperBlock: HTMLCanvasElement | null,
  point: Point, radius: number, color: string, allowOutside: boolean,
) {
  const left = Math.max(0, Math.floor(point.x - radius - 3));
  const top = Math.max(0, Math.floor(point.y - radius - 3));
  const width = Math.min(paint.canvas.width, Math.ceil(point.x + radius + 3)) - left;
  const height = Math.min(paint.canvas.height, Math.ceil(point.y + radius + 3)) - top;
  if (width <= 0 || height <= 0) return;

  scratch.clearRect(left, top, width, height);
  const mist = scratch.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  mist.addColorStop(0, color + '39');
  mist.addColorStop(0.45, color + '1e');
  mist.addColorStop(1, color + '00');
  scratch.fillStyle = mist;
  scratch.fillRect(left, top, width, height);
  scratch.fillStyle = color;
  scratch.globalAlpha = 0.39;
  scratch.beginPath();
  const count = Math.round(radius * 1.7);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.sqrt(Math.random()) * radius;
    const x = point.x + Math.cos(angle) * distance;
    const y = point.y + Math.sin(angle) * distance;
    const grain = 0.45 + Math.random() * 1.28;
    scratch.moveTo(x + grain, y);
    scratch.arc(x, y, grain, 0, Math.PI * 2);
  }
  scratch.fill();
  scratch.globalAlpha = 1;
  if (paperBlock) {
    // The mask contains either the blocking paper or the permitted openings.
    scratch.save();
    scratch.beginPath();
    scratch.rect(left, top, width, height);
    scratch.clip();
    scratch.globalCompositeOperation = allowOutside ? 'destination-out' : 'destination-in';
    scratch.drawImage(paperBlock, left, top, width, height, left, top, width, height);
    scratch.restore();
  }
  paint.drawImage(scratch.canvas, left, top, width, height, left, top, width, height);
}

export function inkBounds({ data, width, height }: ImageData) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!data[(row * width + col) * 4 + 3]) continue;
      left = Math.min(left, col);
      right = Math.max(right, col);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
