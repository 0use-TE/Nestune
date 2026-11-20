import { expect, it } from 'vitest';
import { fitCamera, worldPoint, zoomAt } from '@/lib/canvas-camera';
import { playlistLink, shareUrl } from '@/lib/playlist-link';
it('preserves the world point under the cursor while zooming and accepts negative coordinates', () => {
  const camera = { x: 200, y: -300, zoom: .6 }, cursor = { x: 500, y: 180 };
  expect(worldPoint(cursor, zoomAt(camera, cursor, 1.7))).toEqual(worldPoint(cursor, camera));
  expect(worldPoint({ x: 0, y: -400 }, camera).x).toBeLessThan(0);
  expect(zoomAt(camera, cursor, 100).zoom).toBe(2.5);
});
it('zooms out to the configured overview while keeping the focused point fixed', () => {
  const camera = { x: 140, y: 200, zoom: .2 }, focus = { x: 240, y: 300 };
  const overview = zoomAt(camera, focus, 0, { min: .03, max: 2.5 });
  expect(overview.zoom).toBe(.03);
  expect(worldPoint(focus, overview)).toEqual(worldPoint(focus, camera));
  expect(zoomAt(camera, focus, 0).zoom).toBe(.05);
  expect(zoomAt(camera, focus, 0, { min: .01, max: 2.5 }).zoom).toBe(.02);
});
it('clamps to the chosen zoom-in limit without moving the focused world point', () => {
  const before = { x: -200, y: 100, zoom: 8 }, focus = { x: 400, y: 200 };
  const after = zoomAt(before, focus, before.zoom, { min: .05, max: 3.75 });
  expect(after.zoom).toBe(3.75);
  expect(worldPoint(focus, after)).toEqual(worldPoint(focus, before));
  expect(zoomAt(before, focus, 100, { min: .05, max: 20 }).zoom).toBe(10);
});
it('fits widely separated objects by using the overview range', () => {
  const points = [{ x: 0, y: 0 }, { x: 16_000, y: 0 }];
  const camera = fitCamera(500, 500, points, .02);
  expect(camera.zoom).toBeLessThan(.05);
  expect(camera.zoom).toBeGreaterThan(.02);
  expect(camera.x).toBeGreaterThan(0);
  expect(camera.x + points[1].x * camera.zoom).toBeLessThan(500);
  expect(fitCamera(500, 500, points, .1).zoom).toBe(.1);
});
it('fits separated objects into the viewport with padding', () => {
  const points = [{ x: -800, y: -200 }, { x: 2800, y: 1200 }], camera = fitCamera(1200, 700, points);
  for (const point of points) {
    const x = point.x * camera.zoom + camera.x, y = point.y * camera.zoom + camera.y;
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1200); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(700);
  }
});
it('parses platform playlist links and share text without accepting arbitrary URLs', () => {
  expect(playlistLink('https://music.163.com/#/playlist?id=123')).toEqual({ provider: 'netease', id: '123' });
  expect(playlistLink('https://y.qq.com/n/ryqq/playlist/456')).toEqual({ provider: 'qq', id: '456' });
  expect(playlistLink('https://y.qq.com/n/m/detail/taoge/index.html?id=456')).toEqual({ provider: 'qq', id: '456' });
  expect(playlistLink('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=2386882413')).toEqual({ provider: 'qq', id: '2386882413' });
  expect(playlistLink(shareUrl('分享歌单：https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=2386882413。'))).toEqual({ provider: 'qq', id: '2386882413' });
  expect(shareUrl('分享歌单 https://music.163.com/playlist?id=123。')).toBe('https://music.163.com/playlist?id=123');
  for (const url of ['http://127.0.0.1/playlist?id=123', 'https://music.163.com.evil.test/playlist?id=123', 'https://me@music.163.com/playlist?id=123', 'https://y.qq.com:8888/playlist?id=1', 'https://i2.y.qq.com.evil.test/n3/other/pages/details/playlist.html?id=2386882413', 'https://i2.y.qq.com:8888/n3/other/pages/details/playlist.html?id=2386882413']) expect(playlistLink(url)).toBeNull();
});
