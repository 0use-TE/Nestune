import { CANVAS_OBJECT_LIMIT, DEFAULT_CANVAS_SETTINGS, MAX_CANVAS_OVERVIEW_PERCENT, MAX_CANVAS_ZOOM_LIMIT_PERCENT,
  MIN_CANVAS_OVERVIEW_PERCENT, MIN_CANVAS_ZOOM_LIMIT_PERCENT, isCanvasWallpaper, type CanvasSettings } from '@/lib/canvas-settings';
import { kvGet, kvSet } from './db';
import { fail } from './http';

const key = 'canvas:settings';

export function canvasSettings(): CanvasSettings {
  return { ...DEFAULT_CANVAS_SETTINGS, ...JSON.parse(kvGet(key) ?? '{}') };
}

export function saveCanvasSettings(input: unknown): CanvasSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, '画布设置无效');
  const current = canvasSettings();
  const { wallpaper, personalLimit, totalLimit, allowGraffiti, minZoomPercent = current.minZoomPercent,
    zoomLimitPercent = current.zoomLimitPercent } = input as Record<string, unknown>;
  if (!isCanvasWallpaper(wallpaper) || typeof allowGraffiti !== 'boolean') throw fail(400, '画布壁纸或涂鸦设置无效');
  if (typeof totalLimit !== 'number' || !Number.isInteger(totalLimit) || totalLimit < 1 || totalLimit > CANVAS_OBJECT_LIMIT) {
    throw fail(400, `画布总上限必须是 1 到 ${CANVAS_OBJECT_LIMIT} 之间的整数`);
  }
  if (typeof personalLimit !== 'number' || !Number.isInteger(personalLimit) || personalLimit < 1 || personalLimit > totalLimit) {
    throw fail(400, '每人上限必须是 1 到画布总上限之间的整数');
  }
  if (typeof minZoomPercent !== 'number' || !Number.isInteger(minZoomPercent)
    || minZoomPercent < MIN_CANVAS_OVERVIEW_PERCENT || minZoomPercent > MAX_CANVAS_OVERVIEW_PERCENT) {
    throw fail(400, `最远视角必须是 ${MIN_CANVAS_OVERVIEW_PERCENT}% 到 ${MAX_CANVAS_OVERVIEW_PERCENT}% 之间的整数`);
  }
  if (typeof zoomLimitPercent !== 'number' || !Number.isInteger(zoomLimitPercent)
    || zoomLimitPercent < MIN_CANVAS_ZOOM_LIMIT_PERCENT || zoomLimitPercent > MAX_CANVAS_ZOOM_LIMIT_PERCENT) {
    throw fail(400, `最大缩放比例必须是 ${MIN_CANVAS_ZOOM_LIMIT_PERCENT}% 到 ${MAX_CANVAS_ZOOM_LIMIT_PERCENT}% 之间的整数`);
  }
  const next = { wallpaper, personalLimit, totalLimit, allowGraffiti, minZoomPercent, zoomLimitPercent };
  kvSet(key, JSON.stringify(next));
  return next;
}
