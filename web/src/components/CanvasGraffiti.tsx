'use client';

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import {
  cutStencil, DEFAULT_TEXT_EFFECTS, DEFAULT_TEXT_SHAPE, extendGraffitiArea, GRAFFITI_FONTS, GRAFFITI_FONT_LABELS,
  GRAFFITI_PNG_MAX_BYTES, GRAFFITI_STENCILS, GRAFFITI_TEXT_LIMIT, inkBounds, ROAD_RAGE_SHAPE, sprayPaint, stencilFontFamily, stencilFontNeedsFallback,
  stencilText, TEXT_SHAPES, type GraffitiArea, type GraffitiPlacement,
  type GraffitiFont, type GraffitiPass, type GraffitiStencil, type Point, type TextEffects, type TextShape,
} from '@/lib/canvas-graffiti';
import { WORLD_LIMIT, type Camera } from '@/lib/canvas-camera';
import {
  autoStencilLayers, imageStencilMask, readStencilImage, separateStencilColors, stencilColorMask,
  STENCIL_IMAGE_ACCEPT, type StencilImage, type StencilPose,
} from '@/lib/graffiti-image';
import { loadStencilImage, saveStencilImage } from '@/lib/graffiti-image-storage';
import { PAINT_CARDS, paintFromHex, paintHex, type PaintColor } from '@/lib/graffiti-paint';
import { GraffitiSprayAudio } from '@/lib/graffiti-spray-audio';
import { registerOverlay } from '@/lib/overlays';
import { Icon } from './Icon';
import { GraffitiColorPicker, GraffitiPaintCards } from './GraffitiColorPicker';
import { GraffitiImageLayers, GraffitiSourcePreview } from './GraffitiImageLayers';
import { GraffitiSprayCans } from './GraffitiSprayCans';

const snapshot = (ctx: CanvasRenderingContext2D) => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
const layer = (width: number, height: number, willReadFrequently = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently })!;
};
const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
const textInput = (value: string) => [...value.replace(/[^A-Za-z0-9\p{Script=Han} ，。！？·]/gu, '')].slice(0, GRAFFITI_TEXT_LIMIT).join('');
const preferencesKey = 'nt-graffiti-spray';
function sprayPreferences(): { sound: boolean; outside: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? '{}');
    return { sound: saved?.sound !== false, outside: saved?.outside !== false };
  } catch {
    return { sound: true, outside: true };
  }
}

const pngBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
type PaintSnapshot = { area: GraffitiArea; image: ImageData };
type SprayGesture = { id: number; before: ImageData; last: Point; timer: ReturnType<typeof setInterval> };
type Tab = 'paint' | 'stencil' | 'text' | 'hand';
type EditorStencil = Exclude<GraffitiStencil, { type: 'image' }> | 'image' | null;
export type GraffitiEditorHandle = { cancelGesture: () => void; importImage: (file: File, at?: Point) => Promise<void> };
const letteringPasses: { pass: GraffitiPass; label: string; hex: string }[] = [
  { pass: 'fill', label: '字面', hex: '#f9e331' },
  { pass: 'offset', label: '错位阴影', hex: '#15cee1' },
  { pass: 'outline', label: '描边', hex: '#252422' },
];

function reproject(target: CanvasRenderingContext2D, to: GraffitiArea, from: GraffitiArea, source: HTMLCanvasElement) {
  const scaleX = to.rasterWidth / to.width, scaleY = to.rasterHeight / to.height;
  target.drawImage(source, (from.x - to.x) * scaleX, (from.y - to.y) * scaleY, from.width * scaleX, from.height * scaleY);
}

const textControls: { key: keyof TextShape; label: string; min: number; max: number; step: number; format: (n: number) => string }[] = [
  { key: 'height', label: '字高', min: 0.55, max: 3, step: 0.05, format: n => `${Math.round(n * 100)}%` },
  { key: 'width', label: '字宽', min: 0.45, max: 1.6, step: 0.05, format: n => `${Math.round(n * 100)}%` },
  { key: 'slant', label: '倾斜', min: -28, max: 28, step: 1, format: n => `${n}°` },
  { key: 'tracking', label: '字距', min: -0.08, max: 0.2, step: 0.005, format: n => `${Math.round(n * 100)}%` },
];
const effectControls = [
  { key: 'distance', label: '阴影距离', min: 2, max: 28, suffix: '%' },
  { key: 'angle', label: '阴影方向', min: -180, max: 180, suffix: '°' },
  { key: 'outlineWidth', label: '描边宽度', min: 1, max: 18, suffix: '%' },
] as const;

export function CanvasGraffiti({ ref, accountId, initialArea, dock, camera, movingView, guideDepth, getView, onZoom, onClose, onPublish }: {
  ref: Ref<GraffitiEditorHandle>; accountId?: number; initialArea: GraffitiArea; dock: HTMLElement | null;
  camera: Camera; movingView: boolean; guideDepth: number;
  getView: () => GraffitiArea | null; onZoom: (factor: number) => void;
  onClose: () => void; onPublish: (file: File, placement: GraffitiPlacement) => Promise<void>;
}) {
  const [area, setArea] = useState(initialArea);
  const { zoom } = camera;
  const { rasterWidth, rasterHeight } = area;
  const scaleX = rasterWidth / area.width, scaleY = rasterHeight / area.height;
  const worldUnit = Math.min(initialArea.width / 720, initialArea.height / 440);
  const sizeScale = worldUnit * scaleX;
  const drawing = useRef<HTMLCanvasElement>(null);
  const paper = useRef<HTMLCanvasElement>(null);
  const stencilFile = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const mask = useRef<CanvasRenderingContext2D | null>(null);
  const scratch = useRef<CanvasRenderingContext2D | null>(null);
  const sprayAudio = useRef<GraffitiSprayAudio | null>(null);
  const gesture = useRef<SprayGesture | null>(null);
  const stencilDrag = useRef<{ id: number; offset: Point } | null>(null);
  const history = useRef<PaintSnapshot[]>([]);
  const renderedArea = useRef<GraffitiArea | null>(null);
  const active = useRef(true);
  const [tab, setTab] = useState<Tab>('paint');
  const hand = tab === 'hand';
  const [hasInk, setHasInk] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [cans, setCans] = useState(() => PAINT_CARDS[0].colors.map(paintFromHex));
  const [selectedCan, setSelectedCan] = useState(0);
  const [paintPanel, setPaintPanel] = useState<'picker' | 'cards' | null>(null);
  const [sprayOptions, setSprayOptions] = useState(sprayPreferences);
  const paintColor = cans[selectedCan];
  const [fileHover, setFileHover] = useState(false);
  const color = paintHex(paintColor);
  const [radius, setRadius] = useState(36);
  const [selectedStencil, setStencil] = useState<EditorStencil>(null);
  const [imageSource, setImageSource] = useState<StencilImage | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [basicPose, setBasicPose] = useState<StencilPose>({
    size: 230, rotation: 0, position: { x: initialArea.x + initialArea.width / 2, y: initialArea.y + initialArea.height / 2 },
  });
  const activeImage = selectedStencil === 'image' ? imageSource : null;
  const { position, rotation, size } = activeImage?.pose ?? basicPose;
  const pixels = activeImage?.pixels;
  const imageMode = activeImage?.mode;
  const matchColors = activeImage?.layers.map(layer => layer.sample).join(',');
  const range = activeImage?.range ?? 100;
  const background = activeImage?.background ?? null;
  const activeLayer = activeImage?.selected ?? 0;
  const layerHidden = !!activeImage?.layers[activeLayer]?.hidden;
  const threshold = activeImage?.threshold ?? 128;
  const assignments = useMemo(() => pixels && imageMode === 'colors'
    ? separateStencilColors(pixels, matchColors ? matchColors.split(',') : [], range, background) : null,
  [pixels, imageMode, matchColors, range, background]);
  const imageMask = useMemo(() => {
    if (!pixels || !imageMode) return null;
    if (imageMode !== 'colors') return imageStencilMask(pixels, imageMode, threshold);
    return assignments && !layerHidden ? stencilColorMask(pixels, assignments, activeLayer) : null;
  }, [pixels, imageMode, threshold, assignments, activeLayer, layerHidden]);
  const stencil = useMemo<GraffitiStencil | null>(() => selectedStencil === 'image'
    ? { type: 'image', mask: imageMask } : selectedStencil, [selectedStencil, imageMask]);
  const latestImage = useRef(imageSource);
  latestImage.current = imageSource;
  const storedImage = useRef<StencilImage | null>(null);
  const [handle, setHandle] = useState<Point | null>(null);
  const [draft, setDraft] = useState('');
  const [font, setFont] = useState<GraffitiFont>('Road Rage');
  const [textShape, setTextShape] = useState<TextShape>(ROAD_RAGE_SHAPE);
  const [textEffects, setTextEffects] = useState<TextEffects>(DEFAULT_TEXT_EFFECTS);
  const [transforming, setTransforming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = useRef(onClose);
  close.current = () => { if (!saving) onClose(); };

  useEffect(() => {
    try { localStorage.setItem(preferencesKey, JSON.stringify(sprayOptions)); } catch { /* Preferences can still be changed for this visit. */ }
  }, [sprayOptions]);

  useEffect(() => {
    if (accountId === undefined) return;
    let mounted = true;
    void loadStencilImage(accountId).then(image => {
      if (!mounted || !image || latestImage.current) return;
      storedImage.current = image;
      setImageSource(current => current ?? image);
    }).catch(() => {});
    return () => {
      mounted = false;
      if (latestImage.current && latestImage.current !== storedImage.current) {
        void saveStencilImage(accountId, latestImage.current).catch(() => {});
      }
    };
  }, [accountId]);

  useEffect(() => {
    if (accountId === undefined || !imageSource || storedImage.current === imageSource) return;
    const timer = setTimeout(() => {
      void saveStencilImage(accountId, imageSource).then(() => {
        storedImage.current = imageSource;
      }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [accountId, imageSource]);

  useEffect(() => {
    const dismiss = () => close.current();
    const unregister = registerOverlay(dismiss);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener('keydown', escape);
    return () => { unregister(); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => {
    active.current = true;
    // A painting gesture should not be converted into a compatibility mouse click.
    const surface = paper.current;
    const preventPaintClick = (event: TouchEvent) => event.preventDefault();
    surface?.addEventListener('touchstart', preventPaintClick, { passive: false });
    return () => {
      active.current = false;
      surface?.removeEventListener('touchstart', preventPaintClick);
      if (gesture.current) clearInterval(gesture.current.timer);
      gesture.current = null;
      sprayAudio.current?.dispose();
      sprayAudio.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!drawing.current || !paper.current) return;
    const paint = drawing.current.getContext('2d', { willReadFrequently: true });
    if (!paint || renderedArea.current === area) return;
    const previous = renderedArea.current;
    let copy: CanvasRenderingContext2D | undefined;
    if (previous && hasInk) {
      copy = layer(previous.rasterWidth, previous.rasterHeight);
      copy.drawImage(paint.canvas, 0, 0);
    }
    paint.canvas.width = paper.current.width = area.rasterWidth;
    paint.canvas.height = paper.current.height = area.rasterHeight;
    if (copy && previous) reproject(paint, area, previous, copy.canvas);
    context.current = paint;
    mask.current = layer(area.rasterWidth, area.rasterHeight, true);
    scratch.current = layer(area.rasterWidth, area.rasterHeight);
    renderedArea.current = area;
  }, [area, hasInk]);

  useLayoutEffect(() => {
    const guide = paper.current?.getContext('2d');
    const paperMask = mask.current;
    if (!guide || !paperMask) return;
    guide.clearRect(0, 0, rasterWidth, rasterHeight);
    if (!stencil) {
      setHandle(null);
      return;
    }
    const center = { x: (position.x - area.x) * scaleX, y: (position.y - area.y) * scaleY };
    cutStencil(paperMask, stencil, center, size * sizeScale, textShape, textEffects, rotation,
      { width: initialArea.width * scaleX, height: initialArea.height * scaleY });
    let frame;
    if (stencil.type === 'image' && pixels) {
      const { width: sourceWidth, height: sourceHeight } = pixels;
      const scale = size * sizeScale / Math.max(sourceWidth, sourceHeight);
      const angle = rotation * Math.PI / 180;
      const sin = Math.abs(Math.sin(angle)), cos = Math.abs(Math.cos(angle));
      const width = (sourceWidth * cos + sourceHeight * sin) * scale;
      const height = (sourceWidth * sin + sourceHeight * cos) * scale;
      frame = { x: center.x - width / 2, y: center.y - height / 2, width, height };
    } else {
      frame = inkBounds(snapshot(paperMask));
    }
    if (!frame) {
      setHandle(null);
      return;
    }
    const margin = Math.max(8, 19 * sizeScale);
    const x = frame.x - margin, y = frame.y - margin;
    const width = frame.width + 2 * margin, height = frame.height + 2 * margin;
    setHandle({ x: clamp(x, rasterWidth) / rasterWidth, y: clamp(y, rasterHeight) / rasterHeight });
    guide.save();
    guide.fillStyle = 'rgba(117, 96, 62, .23)';
    guide.fillRect(x, y, width, height);
    guide.strokeStyle = 'rgba(102, 84, 57, .58)';
    guide.setLineDash([4 * sizeScale, 4 * sizeScale]);
    guide.strokeRect(x, y, width, height);
    // The loose stencil paper and the actual clipping mask share the same cutout.
    guide.globalCompositeOperation = 'destination-out';
    guide.drawImage(paperMask.canvas, 0, 0);
    guide.restore();
    if (sprayOptions.outside) {
      paperMask.save();
      paperMask.globalCompositeOperation = 'source-out';
      paperMask.fillRect(x, y, width, height);
      paperMask.restore();
    }
  }, [stencil, pixels, position, size, sizeScale, textShape, textEffects, rotation, area, initialArea, scaleX, scaleY, rasterWidth, rasterHeight, sprayOptions.outside]);

  useLayoutEffect(() => {
    if (hand || movingView || gesture.current || stencilDrag.current) return;
    const view = getView();
    if (!view) return;
    const next = hasInk || history.current.length ? extendGraffitiArea(area, view) : view;
    if (!next) {
      setError('当前视角离这次涂鸦太远，请移近一些再继续喷涂。');
      return;
    }
    if (next.x === area.x && next.y === area.y && next.width === area.width && next.height === area.height) return;
    setArea(next);
  }, [area, camera, getView, hand, hasInk, movingView]);

  function viewCenter() {
    const view = getView() ?? area;
    const boardRect = paper.current?.closest('.nc-board')?.getBoundingClientRect();
    const dockTop = dock?.firstElementChild?.getBoundingClientRect().top;
    const visibleHeight = boardRect && dockTop
      ? Math.max(boardRect.height / 2, Math.min(boardRect.height, dockTop - boardRect.top))
      : view.height * zoom;
    return { x: view.x + view.width / 2, y: view.y + visibleHeight / zoom / 2 };
  }

  function changePose(patch: Partial<StencilPose>) {
    if (selectedStencil === 'image') {
      setImageSource(current => current && { ...current, pose: { ...current.pose, ...patch } });
    } else {
      setBasicPose(current => ({ ...current, ...patch }));
    }
  }

  function centerStencil() {
    changePose({ position: viewCenter() });
  }

  function applyStencil(next: EditorStencil, nextSize = size) {
    setStencil(next);
    if (next && next !== 'image') setBasicPose({ rotation: 0, position: viewCenter(), size: nextSize });
  }

  function moveStencil(point: Point) {
    const inset = 12 / zoom;
    changePose({ position: {
      x: area.x + inset + clamp(point.x - area.x - inset, Math.max(0, area.width - 2 * inset)),
      y: area.y + inset + clamp(point.y - area.y - inset, Math.max(0, area.height - 2 * inset)),
    } });
  }

  function pointAt(event: PointerEvent) {
    const rect = paper.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width * rasterWidth, rasterWidth),
      y: clamp((event.clientY - rect.top) / rect.height * rasterHeight, rasterHeight),
    };
  }

  function moveByHandle(event: PointerEvent<HTMLButtonElement>, start = false) {
    const pixel = pointAt(event);
    const point = { x: area.x + pixel.x / scaleX, y: area.y + pixel.y / scaleY };
    if (start) {
      if (!event.isPrimary || event.button !== 0 || stencilDrag.current || gesture.current || saving) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      stencilDrag.current = { id: event.pointerId, offset: { x: position.x - point.x, y: position.y - point.y } };
    } else if (stencilDrag.current?.id === event.pointerId) {
      moveStencil({ x: point.x + stencilDrag.current.offset.x, y: point.y + stencilDrag.current.offset.y });
    }
  }

  function spray(point: Point) {
    if (!context.current || !scratch.current) return;
    sprayPaint(context.current, scratch.current, stencil ? mask.current?.canvas ?? null : null, point, radius * sizeScale, color, sprayOptions.outside);
  }

  function begin(event: PointerEvent<HTMLCanvasElement>) {
    if (!context.current || gesture.current || stencilDrag.current || hand || movingView || saving || generating || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    if (event.pointerType === 'mouse') event.currentTarget.focus({ preventScroll: true });
    const point = pointAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const before = snapshot(context.current);
    const timer = setInterval(() => {
      if (gesture.current) spray(gesture.current.last);
    }, 48);
    gesture.current = { id: event.pointerId, before, last: point, timer };
    if (sprayOptions.sound) {
      sprayAudio.current ??= new GraffitiSprayAudio();
      sprayAudio.current.start();
    }
    setError('');
    spray(point);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const point = pointAt(event);
    const dx = point.x - current.last.x, dy = point.y - current.last.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / Math.max(2, radius * sizeScale / 3));
    for (let i = 1; i <= steps; i++) {
      spray({ x: current.last.x + dx * i / steps, y: current.last.y + dy * i / steps });
    }
    current.last = point;
  }

  function remember(image: ImageData) {
    history.current.push({ image, area });
    if (history.current.length > 12) history.current.shift();
    setCanUndo(true);
  }

  function finish(pointerId: number, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== pointerId) return;
    gesture.current = null;
    clearInterval(current.timer);
    sprayAudio.current?.stop();
    if (!context.current) return;
    if (cancelled) {
      context.current.putImageData(current.before, 0, 0);
      return;
    }
    const after = snapshot(context.current);
    if (!after.data.some((value, index) => value !== current.before.data[index])) return;
    remember(current.before);
    setHasInk(true);
  }

  useImperativeHandle(ref, () => ({
    cancelGesture() {
      if (gesture.current) finish(gesture.current.id, true);
      stencilDrag.current = null;
    },
    importImage: importStencil,
  }));

  function setPaintColor(next: PaintColor) {
    if (gesture.current) return;
    setCans(current => current.map((can, index) => index === selectedCan ? next : can));
  }

  function applyPalette(next: readonly string[]) {
    if (!gesture.current) setCans(next.map(paintFromHex));
  }

  function toggleSpraySound() {
    if (sprayOptions.sound) sprayAudio.current?.silence();
    setSprayOptions(current => ({ ...current, sound: !current.sound }));
  }

  function selectCan(index: number) {
    if (gesture.current) return false;
    setSelectedCan(index);
    if (sprayOptions.sound) {
      sprayAudio.current ??= new GraffitiSprayAudio();
      sprayAudio.current.shake();
    }
    return true;
  }

  function toggleOutside() {
    if (gesture.current) return;
    setSprayOptions(current => ({ ...current, outside: !current.outside }));
  }

  function undo() {
    if (gesture.current || !context.current) return;
    const previous = history.current.pop();
    if (!previous) return;
    if (previous.area === area) context.current.putImageData(previous.image, 0, 0);
    else {
      const original = layer(previous.area.rasterWidth, previous.area.rasterHeight);
      original.putImageData(previous.image, 0, 0);
      context.current.clearRect(0, 0, rasterWidth, rasterHeight);
      reproject(context.current, area, previous.area, original.canvas);
    }
    setHasInk(!!inkBounds(previous.image));
    setCanUndo(history.current.length > 0);
    setError('');
  }

  function clear() {
    if (gesture.current || !context.current || !hasInk) return;
    remember(snapshot(context.current));
    context.current.clearRect(0, 0, rasterWidth, rasterHeight);
    setHasInk(false);
    setError('');
  }

  async function generate(text: string, selectedFont: GraffitiFont, recenter: boolean) {
    if (!text || generating || saving || gesture.current || stencilDrag.current) return;
    setError('');
    setGenerating(true);
    try {
      const sample = stencilText(selectedFont, text);
      const [loaded] = await Promise.all([
        document.fonts.load(`80px "${selectedFont}"`, sample),
        ...(stencilFontNeedsFallback(selectedFont, sample) ? [document.fonts.load('80px "Ma Shan Zheng"', sample)] : []),
      ]);
      if (!loaded.length) throw new Error('文字模板的字体未加载，请重试。');
      if (active.current) {
        setFont(selectedFont);
        if (!recenter && stencil?.type === 'text') {
          setStencil({ ...stencil, font: selectedFont });
        } else {
          applyStencil({ type: 'text', text, font: selectedFont, pass: 'fill' }, 350);
          setPaintColor(paintFromHex(letteringPasses[0].hex));
        }
      }
    } catch {
      if (active.current) setError('文字模板的字体未加载，请重试。');
    } finally {
      if (active.current) setGenerating(false);
    }
  }

  function selectFont(next: GraffitiFont) {
    if (stencil?.type === 'text') {
      void generate(stencil.text, next, false);
    } else {
      setFont(next);
      if (textShape === DEFAULT_TEXT_SHAPE || textShape === ROAD_RAGE_SHAPE) {
        setTextShape(next === 'Road Rage' ? ROAD_RAGE_SHAPE : DEFAULT_TEXT_SHAPE);
      }
    }
  }

  function updateImage(next: StencilImage) {
    if (gesture.current || stencilDrag.current) return;
    setImageSource(next);
  }

  function reopenImage() {
    if (!imageSource || gesture.current || stencilDrag.current) return;
    setShowPatterns(false);
    setShowSource(false);
    setStencil('image');
  }

  function removeImage() {
    if (gesture.current || stencilDrag.current) return;
    latestImage.current = null;
    storedImage.current = null;
    setImageSource(null);
    if (selectedStencil === 'image') setStencil(null);
    if (accountId !== undefined) void saveStencilImage(accountId, null).catch(() => {});
  }

  async function importStencil(file: File, at?: Point) {
    if (generating || saving || gesture.current || stencilDrag.current) return;
    setGenerating(true);
    setError('');
    try {
      const { pixels, mode } = await readStencilImage(file);
      if (!active.current) return;
      updateImage({
        name: file.name, pixels, mode, threshold: 128, layers: autoStencilLayers(pixels, 3),
        selected: 0, range: 100, background: null, pose: { size: 310, rotation: 0, position: at ?? viewCenter() },
      });
      setShowPatterns(false);
      setShowSource(false);
      setStencil('image');
      setTab('stencil');
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '无法读取模板图片。');
    } finally {
      if (active.current) setGenerating(false);
    }
  }

  function dragImage(event: DragEvent<HTMLButtonElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setFileHover(true);
  }

  function dropImage(event: DragEvent<HTMLButtonElement>) {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    setFileHover(false);
    void importStencil(file);
  }

  async function publish() {
    if (!context.current || gesture.current || saving || !hasInk) return;
    const bounds = inkBounds(snapshot(context.current));
    if (!bounds) return;
    setSaving(true);
    setError('');
    try {
      const output = layer(bounds.width, bounds.height);
      output.drawImage(context.current.canvas, -bounds.x, -bounds.y);
      let blob = await pngBlob(output.canvas);
      if (blob && blob.size > GRAFFITI_PNG_MAX_BYTES) {
        const scale = Math.min(Math.sqrt(GRAFFITI_PNG_MAX_BYTES / blob.size) * .95, 848 / Math.max(bounds.width, bounds.height));
        const reduced = layer(Math.max(1, Math.floor(bounds.width * scale)), Math.max(1, Math.floor(bounds.height * scale)));
        reduced.imageSmoothingQuality = 'high';
        reduced.drawImage(output.canvas, 0, 0, reduced.canvas.width, reduced.canvas.height);
        blob = await pngBlob(reduced.canvas);
      }
      if (!blob) throw new Error('无法生成涂鸦图片，请重试。');
      const x = area.x + (bounds.x + bounds.width / 2) / scaleX;
      const y = area.y + (bounds.y + bounds.height / 2) / scaleY;
      await onPublish(new File([blob], 'graffiti.png', { type: 'image/png' }), {
        x: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, x)),
        y: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, y)),
        width: bounds.width / scaleX,
      });
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '涂鸦发布失败，请重试。');
    } finally {
      if (active.current) setSaving(false);
    }
  }

  const outsideSwitch = <button className={`chip nc-graffiti-spray-toggle ${sprayOptions.outside ? 'on' : ''}`} type="button"
    role="switch" aria-checked={sprayOptions.outside} onClick={toggleOutside}>允许喷到模板外</button>;

  const adjustStencil = stencil && <div className="nc-graffiti-adjust">
    <label className="nc-graffiti-range">模板大小<input type="range" min="110" max="400" value={size}
      onChange={event => changePose({ size: Number(event.target.value) })} /></label>
    <label className="nc-graffiti-range">旋转<input type="range" min="-180" max="180" value={rotation}
      onChange={event => changePose({ rotation: Number(event.target.value) })} /><output>{rotation}°</output></label>
    <button className="btn ghost sm" type="button" onClick={centerStencil}>模板居中</button>
    {outsideSwitch}
  </div>;

  const areaStyle = { left: area.x, top: area.y, width: area.width, height: area.height };
  return <>
    <div className="nc-graffiti-board nc-graffiti-ink" style={areaStyle} aria-hidden="true">
      <canvas ref={drawing} />
    </div>
    <div data-graffiti-draft data-hand={hand ? '' : undefined} data-moving={movingView ? '' : undefined} className="nc-graffiti-board"
      style={{ ...areaStyle, zIndex: guideDepth }}>
        <canvas ref={paper} className="nc-graffiti-guide" tabIndex={-1} aria-label="在画布上喷漆"
          onContextMenu={event => event.preventDefault()} onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event.pointerId)}
          onPointerCancel={event => finish(event.pointerId, true)} onLostPointerCapture={event => finish(event.pointerId, true)} />
        {handle && !hand && !movingView && <button className="nc-stencil-handle ib" type="button"
          aria-label="拖动模板" title="拖动模板"
          style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%`, scale: 1 / zoom }}
          onPointerDown={event => moveByHandle(event, true)} onPointerMove={moveByHandle}
          onLostPointerCapture={() => { stencilDrag.current = null; }}
          onKeyDown={event => {
            const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
            const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
            if (dx || dy) { event.preventDefault(); moveStencil({ x: position.x + dx * 8 / zoom, y: position.y + dy * 8 / zoom }); }
          }}><Icon n="move" s={18} /></button>}
    </div>
    {dock && createPortal(<section className="nc-graffiti-dock" aria-label="涂鸦工具">
      <GraffitiSprayCans colors={cans.map(paintHex)} selected={selectedCan} onSelect={selectCan} />
      <div className="nc-graffiti-dock-chassis panel">
      <div className="nc-graffiti-dock-options">
        {hand && <div className="nc-graffiti-view" role="group" aria-label="涂鸦视角">
          <span className="sub sm">拖动墙面 · 空格拖动 / 中键 / 双指</span>
          <button className="ib" type="button" aria-label="缩小画布" onClick={() => onZoom(1 / 1.25)}>−</button>
          <output>{Math.round(zoom * 100)}%</output>
          <button className="ib" type="button" aria-label="放大画布" onClick={() => onZoom(1.25)}>+</button>
        </div>}
        {tab === 'paint' && <>
          <div className="nc-graffiti-paints">
            <div className="nc-graffiti-paint-tools">
              <button className="btn ghost sm nc-graffiti-custom-color" type="button" aria-expanded={paintPanel === 'picker'}
                onClick={() => setPaintPanel(paintPanel === 'picker' ? null : 'picker')}>
                <i style={{ background: color }} />调色盘
              </button>
              <button className="btn ghost sm" type="button" aria-expanded={paintPanel === 'cards'}
                onClick={() => setPaintPanel(paintPanel === 'cards' ? null : 'cards')}>色卡</button>
              <button className={`chip nc-graffiti-spray-toggle ${sprayOptions.sound ? 'on' : ''}`} type="button"
                role="switch" aria-checked={sprayOptions.sound} onClick={toggleSpraySound}>喷漆音效</button>
              {stencil && outsideSwitch}
            </div>
            <label className="nc-graffiti-range">喷幅<input type="range" min="12" max="92" value={radius} onChange={event => setRadius(Number(event.target.value))} /></label>
          </div>
          {paintPanel === 'picker' && <GraffitiColorPicker color={paintColor} selectedCan={selectedCan} onChange={setPaintColor} onApply={applyPalette} />}
          {paintPanel === 'cards' && <GraffitiPaintCards onApply={applyPalette} />}
        </>}
        {tab === 'stencil' && <>
          <div className="nc-graffiti-stencils" role="group" aria-label="镂空模板">
            <button className={`chip ${!stencil ? 'on' : ''}`} type="button" aria-pressed={!stencil} onClick={() => applyStencil(null)}>移开模板</button>
            {activeImage && <button className={`chip ${showPatterns ? 'on' : ''}`} type="button" aria-expanded={showPatterns}
              onClick={() => setShowPatterns(!showPatterns)}>内置图案</button>}
            {(!activeImage || showPatterns) && GRAFFITI_STENCILS.map(shape => {
              const selected = stencil?.type === 'shape' && stencil.path === shape.path;
              return <button key={shape.id} className={`chip ${selected ? 'on' : ''}`} type="button" aria-label={shape.label}
                title={shape.label} aria-pressed={selected} onClick={() => applyStencil({ type: 'shape', path: shape.path }, 260)}>
                <svg viewBox="0 0 100 100" aria-hidden="true"><path d={shape.path} fill="currentColor" fillRule="evenodd" /></svg>
              </button>;
            })}
          </div>
          <button className={`nc-graffiti-file-drop ${fileHover ? 'is-dragged-over' : ''}`} type="button"
            aria-label={imageSource ? '换图片' : '导入图片'} disabled={generating || saving}
            onClick={() => stencilFile.current?.click()} onDragOver={dragImage} onDragLeave={() => setFileHover(false)} onDrop={dropImage}>
            <Icon n="picture" s={17} />{generating ? '读取中…' : imageSource ? '拖入图片或点此更换' : '拖入图片或点击选择'}
          </button>
          <input ref={stencilFile} type="file" accept={STENCIL_IMAGE_ACCEPT} aria-label="选择模板图片" hidden
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importStencil(file);
            }} />
          {imageSource && <div className="nc-graffiti-saved-image">
            {activeImage ? <Icon n="picture" s={14} /> : <button className="chip" type="button"
              onClick={reopenImage}><Icon n="picture" s={14} />已导入图片</button>}
            <span className="sub sm nc-graffiti-image-name" title={imageSource.name}>{imageSource.name}</span>
            {activeImage && <button className="chip" type="button" aria-expanded={showSource}
              onClick={() => setShowSource(!showSource)}>查看导入图</button>}
            <button className="ib" aria-label="删除已导入图片" title="删除已导入图片" type="button" onClick={removeImage}><Icon n="x" s={15} /></button>
          </div>}
          {activeImage && <>
            {showSource && <GraffitiSourcePreview pixels={activeImage.pixels} />}
            <div className="nc-graffiti-text-presets" role="group" aria-label="图片取形方式">
              {([['colors', '颜色分层'], ['alpha', '不透明处'], ['dark', '暗部'], ['light', '亮部']] as const).map(([mode, label]) => <button key={mode}
                className={`chip ${activeImage.mode === mode ? 'on' : ''}`} type="button" aria-pressed={activeImage.mode === mode}
                onClick={() => updateImage({ ...activeImage, mode })}>{label}</button>)}
              {activeImage.mode !== 'colors' && <label className="nc-graffiti-range">阈值<input type="range" min="1" max="254" value={activeImage.threshold}
                onChange={event => updateImage({ ...activeImage, threshold: Number(event.target.value) })} /></label>}
            </div>
            {assignments && <GraffitiImageLayers image={activeImage} assignments={assignments} onChange={updateImage}
              onPickPaint={hex => setPaintColor(paintFromHex(hex))} />}
            {!imageMask && <span className="sub sm" role="status">{layerHidden && activeImage.mode === 'colors'
              ? '这一层已留空。' : '当前没有可喷区域，请调整取样色、匹配范围或阈值。'}</span>}
          </>}
          {adjustStencil}
        </>}
        {tab === 'text' && <>
          <div className="nc-graffiti-text-presets" role="group" aria-label="文字模板风格">
            <label className="nc-graffiti-range">字体<select value={font} disabled={generating || saving}
              onChange={event => selectFont(event.target.value as GraffitiFont)}>
              {GRAFFITI_FONTS.map(name => <option key={name} value={name}>{GRAFFITI_FONT_LABELS[name] ?? name}</option>)}
            </select></label>
          </div>
          <form className="nc-graffiti-text" onSubmit={event => {
            event.preventDefault();
            if (composing.current) return;
            event.currentTarget.querySelector('input')?.blur();
            void generate(draft.trim().replace(/ +/g, ' '), font, true);
          }}>
            <input style={{ fontFamily: stencilFontFamily(font, draft), textTransform: stencilText(font, 'a') === 'A' ? 'uppercase' : undefined }}
              aria-label="涂鸦模板文字" placeholder="中文、英文或数字" value={draft}
              autoCapitalize="off" spellCheck={false}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={event => { composing.current = false; setDraft(textInput(event.currentTarget.value)); }}
              onChange={event => setDraft(composing.current ? event.target.value : textInput(event.target.value))} />
            <button className="btn sm" disabled={!draft.trim() || generating}>{generating ? '生成中…' : '生成模板'}</button>
          </form>
          {stencil?.type === 'text' && <div className="nc-graffiti-text-presets" role="group" aria-label="文字分色模板">
            {letteringPasses.map(({ pass, label, hex }) => <button key={pass}
              className={`chip nc-graffiti-pass ${stencil.pass === pass ? 'on' : ''}`} type="button" aria-pressed={stencil.pass === pass}
              onClick={() => { setStencil({ ...stencil, pass }); setPaintColor(paintFromHex(hex)); }}>
              <i style={{ background: hex }} aria-hidden="true" />{label}
            </button>)}
          </div>}
          <div className="nc-graffiti-text-presets" role="group" aria-label="字形预设">
            {TEXT_SHAPES.map(({ label, shape }) => <button className="chip" key={label} type="button" onClick={() => setTextShape(shape)}>{label}</button>)}
            <button className="chip" type="button" onClick={() => setTextShape(DEFAULT_TEXT_SHAPE)}>原形</button>
            <button className={`chip ${transforming ? 'on' : ''}`} type="button" aria-expanded={transforming} onClick={() => setTransforming(!transforming)}>细调</button>
          </div>
          {transforming && <div className="nc-graffiti-shape-controls">
            {textControls.map(control => <label className="nc-graffiti-range" key={control.key}>
              <span>{control.label}</span>
              <input type="range" aria-label={control.label} min={control.min} max={control.max} step={control.step} value={textShape[control.key]}
                onChange={event => setTextShape({ ...textShape, [control.key]: Number(event.target.value) })} />
              <output>{control.format(textShape[control.key])}</output>
            </label>)}
            {effectControls.map(control => <label className="nc-graffiti-range" key={control.key}>
              <span>{control.label}</span>
              <input type="range" aria-label={control.label} min={control.min} max={control.max} value={textEffects[control.key]}
                onChange={event => setTextEffects({ ...textEffects, [control.key]: Number(event.target.value) })} />
              <output>{textEffects[control.key]}{control.suffix}</output>
            </label>)}
            <label className="nc-graffiti-range nc-graffiti-shadow-outline">
              <input type="checkbox" checked={textEffects.wrapShadow}
                onChange={event => setTextEffects({ ...textEffects, wrapShadow: event.target.checked })} />描边包含阴影
            </label>
          </div>}
          {stencil?.type === 'text' && adjustStencil}
        </>}
        {error && <p className="sub sm nc-graffiti-error" role="alert">{error}</p>}
      </div>
      <div className="nc-graffiti-bar">
        <div className="nc-graffiti-tabs" role="group" aria-label="涂鸦工具类型">
          {([['paint', '喷漆'], ['hand', '手'], ['stencil', '图案'], ['text', '文字']] as const).map(([id, label]) =>
            <button key={id} className={`chip ${tab === id ? 'on' : ''}`} type="button" aria-pressed={tab === id}
              onClick={() => { if (!gesture.current && !stencilDrag.current) setTab(id); }}>
              {id === 'hand' && <Icon n="hand" s={14} />}{label}
            </button>)}
        </div>
        <div className="nc-graffiti-actions">
          <button className="ib" type="button" disabled={!canUndo || saving} onClick={undo} aria-label="撤销喷漆" title="撤销喷漆"><Icon n="undo" s={17} /></button>
          <button className="ib" type="button" disabled={!hasInk || saving} onClick={clear} aria-label="清空喷漆" title="清空喷漆"><Icon n="trash" s={16} /></button>
          <button className="btn sm" type="button" disabled={!hasInk || saving || generating} onClick={() => void publish()}>{saving ? '保存中…' : '完成'}</button>
          <button className="ib" type="button" disabled={saving} onClick={onClose} aria-label="丢弃涂鸦" title="丢弃涂鸦"><Icon n="x" s={16} /></button>
        </div>
      </div>
      </div>
    </section>, dock)}
  </>;
}
