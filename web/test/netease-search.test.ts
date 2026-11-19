import { afterEach, expect, it, vi } from 'vitest';
import { search } from '@/server/netease';

afterEach(() => { vi.unstubAllGlobals(); });

const timeout = { body: { code: 502, msg: 'timeout of 1800ms exceeded' } };

it('retries a network timeout on the alternate endpoint and keeps results if access metadata times out', async () => {
  const cloudsearch = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce({
    body: { code: 200, result: { songs: [{ id: 1, name: 'Track' }], songCount: 1 } },
  });
  const songDetail = vi.fn().mockRejectedValue({ body: { code: 502, msg: 'timeout of 1000ms exceeded' } });
  vi.stubGlobal('__nt_up', { cloudsearch, song_detail: songDetail });
  vi.stubGlobal('__nt_sess', { cookie: {} });
  vi.stubGlobal('__nt_meta', new Map());

  await expect(search('Track', 'song', 10, 0)).resolves.toMatchObject({
    total: 1, items: [{ id: '1', name: 'Track' }],
  });
  expect(cloudsearch).toHaveBeenNthCalledWith(1, expect.objectContaining({ crypto: 'weapi', timeout: 1800 }));
  expect(cloudsearch).toHaveBeenNthCalledWith(2, expect.objectContaining({ timeout: 1600 }));
  expect(cloudsearch.mock.calls[1][0]).not.toHaveProperty('crypto');
  expect(songDetail).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1000 }));
});

it('preserves a risk-control response without retrying the other endpoint', async () => {
  const cloudsearch = vi.fn().mockRejectedValue({ body: { code: -460 } });
  vi.stubGlobal('__nt_up', { cloudsearch });
  await expect(search('Track', 'song', 10, 0)).rejects.toMatchObject({ code: 'source_risk_control' });
  expect(cloudsearch).toHaveBeenCalledTimes(1);
});
