import { DEFAULT_CANVAS_SETTINGS, MAX_CANVAS_ZOOM_LIMIT_PERCENT, MIN_CANVAS_OVERVIEW_PERCENT } from './canvas-settings';

export type Camera = { x: number; y: number; zoom: number };
export const CANVAS_DRAG_THRESHOLD = 7;
export type ZoomLimits = { min: number; max: number };
export const MIN_ZOOM = MIN_CANVAS_OVERVIEW_PERCENT / 100, MAX_ZOOM = MAX_CANVAS_ZOOM_LIMIT_PERCENT / 100, WORLD_LIMIT = 1_000_000;
export const DEFAULT_ZOOM_LIMITS: ZoomLimits = {
  min: DEFAULT_CANVAS_SETTINGS.minZoomPercent / 100, max: DEFAULT_CANVAS_SETTINGS.zoomLimitPercent / 100,
};
export const worldPoint = (p: { x: number; y: number }, camera: Camera) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom });
export function zoomAt(camera: Camera, point: { x: number; y: number }, zoom: number, limits = DEFAULT_ZOOM_LIMITS): Camera {
  const next = Math.max(MIN_ZOOM, limits.min, Math.min(MAX_ZOOM, limits.max, zoom));
  if (next === camera.zoom) return camera;
  const world = worldPoint(point, camera);
  return { x: point.x - world.x * next, y: point.y - world.y * next, zoom: next };
}
export function fitCamera(width: number, height: number, points: { x: number; y: number }[], minZoom = DEFAULT_ZOOM_LIMITS.min): Camera {
  const xs = points.length ? points.map(p => p.x) : [180, 820], ys = points.length ? points.map(p => p.y) : [130, 520];
  const left = Math.min(...xs) - 120, right = Math.max(...xs) + 120, top = Math.min(...ys) - 120, bottom = Math.max(...ys) + 120;
  const zoom = Math.max(MIN_ZOOM, minZoom, Math.min(1, width / (right - left), height / (bottom - top)));
  return { x: width / 2 - (left + right) / 2 * zoom, y: height / 2 - (top + bottom) / 2 * zoom, zoom };
}
