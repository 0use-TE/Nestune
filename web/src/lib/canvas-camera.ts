export type Camera = { x: number; y: number; zoom: number };
export const CANVAS_DRAG_THRESHOLD = 7;
export const MIN_ZOOM = .2, MAX_ZOOM = 2.5, WORLD_LIMIT = 1_000_000;
export const worldPoint = (p: { x: number; y: number }, camera: Camera) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom });
export function zoomAt(camera: Camera, point: { x: number; y: number }, zoom: number): Camera {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)), world = worldPoint(point, camera);
  return { x: point.x - world.x * next, y: point.y - world.y * next, zoom: next };
}
export function fitCamera(width: number, height: number, points: { x: number; y: number }[]): Camera {
  const xs = points.length ? points.map(p => p.x) : [180, 820], ys = points.length ? points.map(p => p.y) : [130, 520];
  const left = Math.min(...xs) - 120, right = Math.max(...xs) + 120, top = Math.min(...ys) - 120, bottom = Math.max(...ys) + 120;
  const zoom = Math.max(MIN_ZOOM, Math.min(1, width / (right - left), height / (bottom - top)));
  return { x: width / 2 - (left + right) / 2 * zoom, y: height / 2 - (top + bottom) / 2 * zoom, zoom };
}
