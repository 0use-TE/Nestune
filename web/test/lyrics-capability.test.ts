import { expect, it } from 'vitest';
import { lyricsOpenFailure, lyricsTransport, type LyricsEnvironment } from '@/lib/lyrics-capability';
const browser: LyricsEnvironment = { desktop: false, android: false, tauri: false, embedded: false, secure: true, pictureInPicture: true, userAgent: 'Chrome/130' };
it('does not mistake Document PiP exposure in older Windows wrappers for a working native window', () => {
  expect(lyricsTransport({ ...browser, embedded: true, userAgent: 'Chrome NestuneDesktop/1.0.0' })).toBe('upgrade');
  expect(lyricsTransport({ ...browser, userAgent: 'Chrome NestuneDesktop/1.0.0' })).toBe('upgrade');
  expect(lyricsTransport({ ...browser, embedded: true })).toBe('upgrade');
});
it('prefers the native bridge, including a recovered Tauri bridge, over the browser API', () => {
  expect(lyricsTransport({ ...browser, desktop: true, embedded: true })).toBe('native');
  expect(lyricsTransport({ ...browser, tauri: true })).toBe('native');
  expect(lyricsTransport({ ...browser, android: true })).toBe('native');
});
it('offers PiP only to secure standalone browsers and gives actionable failures without raw WebView errors', () => {
  expect(lyricsTransport(browser)).toBe('pip');
  expect(lyricsTransport({ ...browser, secure: false })).toBe('unsupported');
  expect(lyricsTransport({ ...browser, pictureInPicture: false })).toBe('unsupported');
  expect(lyricsOpenFailure(true)).toContain('下载安装新版');
  expect(lyricsOpenFailure(false)).toContain('应用内歌词仍可使用');
});
