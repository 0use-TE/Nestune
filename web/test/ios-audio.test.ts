import { afterEach, expect, it, vi } from 'vitest';
import { isIosHomeScreen, readIosProgress, saveIosProgress } from '@/lib/ios-audio';

afterEach(() => vi.unstubAllGlobals());

it('limits the audio handoff to installed iOS web apps, including desktop-mode iPads', () => {
  const matchMedia = vi.fn(() => ({ matches: false }));
  vi.stubGlobal('window', { matchMedia });
  vi.stubGlobal('navigator', { userAgent: 'iPhone', standalone: false, maxTouchPoints: 5 });
  expect(isIosHomeScreen()).toBe(false);
  vi.stubGlobal('navigator', { userAgent: 'iPhone', standalone: true, maxTouchPoints: 5 });
  expect(isIosHomeScreen()).toBe(true);
  vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 });
  matchMedia.mockReturnValue({ matches: true });
  expect(isIosHomeScreen()).toBe(true);
  vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 });
  expect(isIosHomeScreen()).toBe(false);
});

it('restores the queue occurrence and progress for the same user, including an explicit rewind', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) });
  const queue = ['10', '20', '20', '30'];
  saveIosProgress(2, queue, 2, 18.25);
  expect(readIosProgress(2, queue)).toEqual({ index: 2, position: 18.25 });
  expect(readIosProgress(3, queue)).toBeNull();
  expect(readIosProgress(2, ['10', '20', '30'])).toBeNull();
  saveIosProgress(2, queue, 2, 0);
  expect(readIosProgress(2, queue)).toEqual({ index: 2, position: 0 });
  values.set('nt-ios-progress:2', '{"queue":"10,20,20,30","index":4,"position":25}');
  expect(readIosProgress(2, queue)).toBeNull();
});
