import type { Camera } from './canvas-camera';

export type WallMark = { key: string; src: string; left: number; top: number; width: number; height: number };
type Area = { x: number; y: number; width: number; height: number };
type Asset = {
  url: string; image?: HTMLImageElement; imageUrl?: string; pending?: HTMLImageElement;
  failures: number; retryAfter: number; timer?: number;
};
const TEXTURE_PERIOD = 920;
const WALL_COLOR = '#bdbab4';
const MAX_LOADS = 6;
const MAX_CACHED_PIXELS = 12_000_000;

export class CanvasWallPainter {
  private context: CanvasRenderingContext2D | null;
  private texture: HTMLImageElement;
  private pattern: CanvasPattern | null = null;
  private observer: ResizeObserver;
  private view: Camera = { x: 0, y: 0, zoom: 1 };
  private board: Area = { x: 0, y: 0, width: 0, height: 0 };
  private scaleX = 1;
  private scaleY = 1;
  private marks: readonly WallMark[] = [];
  private assets = new Map<string, Asset>();
  private inFlight = 0;
  private frame = 0;
  private practicing = false;
  private hasError = false;
  private disposed = false;

  constructor(private surface: HTMLCanvasElement, private boardElement: HTMLDivElement,
    private onErrorChange: (value: boolean) => void) {
    this.context = surface.getContext('2d', { alpha: false });
    this.texture = new Image();
    this.texture.onload = () => { this.updatePattern(); this.schedule(); };
    this.texture.src = '/canvas-walls/concrete.webp';
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(surface);
    this.observer.observe(boardElement);
    window.addEventListener('online', this.retry);
    this.measure();
  }

  setView(view: Camera) {
    this.view = view;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
  }

  setMarks(marks: readonly WallMark[]) {
    this.marks = marks;
    this.schedule();
  }

  setPractice(practicing: boolean) {
    this.practicing = practicing;
    this.schedule();
  }

  retry = () => {
    for (const asset of this.assets.values()) {
      if (!asset.failures) continue;
      clearTimeout(asset.timer);
      asset.retryAfter = 0;
      asset.failures = 0;
    }
    this.schedule();
  };

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    window.removeEventListener('online', this.retry);
    cancelAnimationFrame(this.frame);
    this.texture.onload = null;
    for (const asset of this.assets.values()) this.drop(asset);
    this.assets.clear();
  }

  private updatePattern() {
    this.pattern = this.texture.naturalWidth ? this.context?.createPattern(this.texture, 'repeat') ?? null : null;
  }

  private measure() {
    const rect = this.surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const board = this.boardElement.getBoundingClientRect();
    this.board = { x: board.left - rect.left, y: board.top - rect.top, width: board.width, height: board.height };
    const density = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(rect.width, rect.height),
      Math.sqrt(3_200_000 / (rect.width * rect.height)));
    const width = Math.max(1, Math.round(rect.width * density)), height = Math.max(1, Math.round(rect.height * density));
    if (this.surface.width !== width || this.surface.height !== height) {
      this.surface.width = width;
      this.surface.height = height;
      this.updatePattern();
    }
    this.scaleX = width / rect.width;
    this.scaleY = height / rect.height;
    this.schedule();
  }

  private schedule() {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private drop(asset: Asset) {
    clearTimeout(asset.timer);
    if (!asset.pending) return;
    asset.pending.onload = asset.pending.onerror = null;
    asset.pending.removeAttribute('src');
    this.inFlight--;
  }

  private asset(mark: WallMark) {
    const current = this.assets.get(mark.key);
    if (current?.url === mark.src) return current;
    const next = { url: mark.src, image: current?.image, imageUrl: current?.imageUrl, failures: 0, retryAfter: 0 };
    if (current) this.drop(current);
    this.assets.set(mark.key, next);
    return next;
  }

  private load(asset: Asset, now: number) {
    if (asset.pending || asset.failures >= 3 || asset.retryAfter > now || !navigator.onLine || this.inFlight >= MAX_LOADS) return;
    const image = new Image();
    image.decoding = 'async';
    asset.pending = image;
    this.inFlight++;
    const finish = () => {
      asset.pending = undefined;
      this.inFlight--;
      this.schedule();
    };
    image.onload = () => {
      asset.image = image;
      asset.imageUrl = asset.url;
      asset.failures = 0;
      finish();
    };
    image.onerror = () => {
      asset.failures++;
      const delay = 1000 * asset.failures + Math.random() * 300;
      asset.retryAfter = performance.now() + delay;
      if (asset.failures < 3) asset.timer = window.setTimeout(() => this.schedule(), delay + 5);
      finish();
    };
    image.src = asset.failures ? asset.url + (asset.url.includes('?') ? '&' : '?') + 'retry=' + Date.now() : asset.url;
  }

  private evict(nearby: Set<string>) {
    let pixels = 0;
    for (const { image } of this.assets.values()) pixels += image ? image.naturalWidth * image.naturalHeight : 0;
    for (const [key, asset] of this.assets) {
      if (nearby.has(key)) continue;
      if (!asset.image || pixels > MAX_CACHED_PIXELS) {
        this.drop(asset);
        this.assets.delete(key);
        if (asset.image) pixels -= asset.image.naturalWidth * asset.image.naturalHeight;
      }
    }
  }

  private draw() {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    const { x, y, zoom } = this.view;
    const { x: bx, y: by, width, height } = this.board;
    const { scaleX, scaleY } = this;
    // Snap both sides of every tile to the same device-pixel grid.
    const px = (world: number) => Math.round((bx + x + world * zoom) * scaleX);
    const py = (world: number) => Math.round((by + y + world * zoom) * scaleY);
    const period = TEXTURE_PERIOD * zoom;
    if (typeof this.pattern?.setTransform === 'function') {
      this.pattern.setTransform({
        a: period * scaleX / this.texture.naturalWidth, d: period * scaleY / this.texture.naturalHeight,
        e: (bx + x) % period * scaleX, f: (by + y) % period * scaleY,
      });
    }
    ctx.fillStyle = WALL_COLOR;
    ctx.fillRect(0, 0, this.surface.width, this.surface.height);
    if (this.pattern) {
      ctx.fillStyle = this.pattern;
      ctx.fillRect(0, 0, this.surface.width, this.surface.height);
    }
    if (!this.surface.hasAttribute('data-ready')) this.surface.setAttribute('data-ready', '');
    if (this.practicing || !width || !height) return;

    const left = -x / zoom, right = (width - x) / zoom, top = -y / zoom, bottom = (height - y) / zoom;
    const margin = 256;
    const nearby = new Set<string>();
    const prefetch: Asset[] = [];
    const loadNow: Asset[] = [];
    const now = performance.now();
    let failed = false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(bx * scaleX), Math.round(by * scaleY),
      Math.round((bx + width) * scaleX) - Math.round(bx * scaleX),
      Math.round((by + height) * scaleY) - Math.round(by * scaleY));
    ctx.clip();
    for (const mark of this.marks) {
      const endX = mark.left + mark.width, endY = mark.top + mark.height;
      if (endX <= left - margin || mark.left >= right + margin || endY <= top - margin || mark.top >= bottom + margin) continue;
      const visible = endX > left && mark.left < right && endY > top && mark.top < bottom;
      nearby.add(mark.key);
      const asset = this.asset(mark);
      if (asset.imageUrl !== asset.url) {
        (visible ? loadNow : prefetch).push(asset);
        failed ||= visible && !asset.image && asset.failures > 0;
      }
      if (visible && asset.image) {
        const drawX = px(mark.left), drawY = py(mark.top);
        ctx.drawImage(asset.image, drawX, drawY, px(endX) - drawX, py(endY) - drawY);
      }
    }
    ctx.restore();
    for (const asset of loadNow) this.load(asset, now);
    for (const asset of prefetch) this.load(asset, now);
    this.evict(nearby);
    if (failed !== this.hasError) {
      this.hasError = failed;
      this.onErrorChange(failed);
    }
  }
}
