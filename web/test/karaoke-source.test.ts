import { afterEach, expect, it, vi } from 'vitest';
import { lyrics } from '@/server/netease';
const globals = globalThis as typeof globalThis & { __nt_up?: unknown };
const previous = globals.__nt_up;
afterEach(() => { globals.__nt_up = previous; });
it('requests real word timing while preserving translated vocal lines', async () => {
  const request = vi.fn(async () => ({ body: { code: 200, lrc: { lyric: '[00:01.00]风' }, yrc: { lyric: '[1000,1800](1000,1800,0)风' }, ytlrc: { lyric: '[00:01.00]wind' } } }));
  globals.__nt_up = { lyric_new: request };
  const result = await lyrics('123');
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ id: '123' }));
  expect(result.lines[0]).toMatchObject({ t: 1, text: '风', tr: 'wind', words: [{ t: 1, d: 1.8, text: '风' }] });
});
it('retains ordinary lyrics if the new upstream endpoint is unavailable', async () => {
  globals.__nt_up = { lyric_new: vi.fn(async () => { throw Error('unsupported'); }), lyric: vi.fn(async () => ({ body: { code: 200, lrc: { lyric: '[00:02.00]原来的歌词' } } })) };
  const result = await lyrics('123');
  expect(result.lines[0]).toMatchObject({ t: 2, text: '原来的歌词' });
  expect(result.lines[0].words).toBeUndefined();
});
