import { expect, it } from 'vitest';
import { fitCamera, worldPoint, zoomAt } from '@/lib/canvas-camera';
import { playlistLink, shareUrl } from '@/lib/playlist-link';
it('preserves the world point under the cursor while zooming and accepts negative coordinates', () => {
  const camera = { x: 200, y: -300, zoom: .6 }, cursor = { x: 500, y: 180 };
  expect(worldPoint(cursor, zoomAt(camera, cursor, 1.7))).toEqual(worldPoint(cursor, camera));
  expect(worldPoint({ x: 0, y: -400 }, camera).x).toBeLessThan(0);
  expect(zoomAt(camera, cursor, 100).zoom).toBe(2.5);
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
  expect(shareUrl('分享歌单 https://music.163.com/playlist?id=123。')).toBe('https://music.163.com/playlist?id=123');
  for (const url of ['http://127.0.0.1/playlist?id=123', 'https://music.163.com.evil.test/playlist?id=123', 'https://me@music.163.com/playlist?id=123', 'https://y.qq.com:8888/playlist?id=1']) expect(playlistLink(url)).toBeNull();
});
