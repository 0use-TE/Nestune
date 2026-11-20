export const CANVAS_WALLPAPERS = {
  concrete: { name: '灰色混凝土', color: '#bdbab4', image: '/canvas-walls/concrete.webp', period: 920 },
  plaster: { name: '米白灰泥', color: '#f1eadb', image: '/canvas-walls/plaster.webp', period: 920 },
  plain: { name: '米白纯色', color: '#f1eadb', image: null, period: 920 },
} as const;

export type CanvasWallpaper = keyof typeof CANVAS_WALLPAPERS;
export type CanvasSettings = {
  wallpaper: CanvasWallpaper;
  personalLimit: number;
  totalLimit: number;
  minZoomPercent: number;
  zoomLimitPercent: number;
  syncIntervalSeconds: number;
  allowGraffiti: boolean;
};

export const CANVAS_OBJECT_LIMIT = 500;
export const MIN_CANVAS_OVERVIEW_PERCENT = 2;
export const MAX_CANVAS_OVERVIEW_PERCENT = 20;
export const MIN_CANVAS_ZOOM_LIMIT_PERCENT = 100;
export const MAX_CANVAS_ZOOM_LIMIT_PERCENT = 1000;
export const MIN_CANVAS_SYNC_SECONDS = 2;
export const MAX_CANVAS_SYNC_SECONDS = 60;
export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  wallpaper: 'concrete',
  personalLimit: 30,
  totalLimit: 200,
  minZoomPercent: 5,
  zoomLimitPercent: 250,
  syncIntervalSeconds: 20,
  allowGraffiti: true,
};

export function isCanvasWallpaper(value: unknown): value is CanvasWallpaper {
  return typeof value === 'string' && Object.hasOwn(CANVAS_WALLPAPERS, value);
}
