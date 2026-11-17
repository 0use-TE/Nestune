import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadUrl, mediaData, mediaUrl } from '@/server/netease';
import { fetchSourceAudio } from '@/server/media';

const state = globalThis as typeof globalThis & { __nt_up?: unknown; __nt_sess?: unknown };
const original = { upstream: state.__nt_up, session: state.__nt_sess };
const full = { id: 21178262, code: 200, url: 'https://m7.music.126.net/allowed.mp3', level: 'standard',
  time: 293506, size: 4697069, freeTrialInfo: null, freeTrialPrivilege: { resConsumable: false } };
let player: ReturnType<typeof vi.fn>, downloader: ReturnType<typeof vi.fn>;

beforeEach(() => {
  player = vi.fn(async () => ({ body: { code: 200, data: [full] } }));
  downloader = vi.fn(async () => ({ body: { code: 200, data: { id: 21178262, code: -103, url: null } } }));
  state.__nt_up = { song_url_v1: player, song_download_url_v1: downloader };
  state.__nt_sess = { cookie: 'MUSIC_U=test-session-only' };
});
afterEach(() => {
  state.__nt_up = original.upstream; state.__nt_sess = original.session;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('independent playback and download permissions', () => {
  it('plays the complete VIP song even when the download endpoint denies it', async () => {
    await expect(mediaUrl('21178262', 'standard')).resolves.toMatchObject({ time: 293506, url: full.url });
    expect(player).toHaveBeenCalledWith(expect.objectContaining({ id: '21178262', level: 'standard',
      cookie: 'MUSIC_U=test-session-only', crypto: 'weapi', unblock: false }));
    expect(downloader).not.toHaveBeenCalled();
    await expect(downloadUrl('21178262', 'standard')).rejects.toMatchObject({ status: 403, code: 'download_no_access' });
    expect(player).toHaveBeenCalledTimes(1);
  });
  it('keeps explicit downloads on the download endpoint and never falls back to playback', async () => {
    await expect(fetchSourceAudio('21178262', 'lossless', AbortSignal.timeout(1000), 'download'))
      .rejects.toMatchObject({ status: 403, code: 'download_no_access' });
    expect(downloader).toHaveBeenCalledWith(expect.objectContaining({ id: '21178262', level: 'lossless' }));
    expect(player).not.toHaveBeenCalled();
  });
  it('reads the permitted playback audio and preserves its actual quality', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const audio = await fetchSourceAudio('21178262', 'standard', AbortSignal.timeout(1000));
    expect(audio).toMatchObject({ ext: 'mp3', level: 'standard', mime: 'audio/mpeg' });
    await audio.body.cancel();
    expect(downloader).not.toHaveBeenCalled();
  });
  it('rejects previews and denied playback instead of treating them as full audio', async () => {
    for (const data of [{ ...full, freeTrialInfo: { start: 0, end: 30000 } },
      { ...full, freeTrialPrivilege: { resConsumable: true } }, { ...full, code: -103, url: null }]) {
      player.mockResolvedValue({ body: { code: 200, data: [data] } });
      await expect(mediaUrl('21178262', 'standard')).rejects.toMatchObject({ status: 403, code: 'no_access' });
    }
    expect(downloader).not.toHaveBeenCalled();
  });
  it('does not request anonymous playback when the bound session is missing', async () => {
    state.__nt_sess = {};
    await expect(mediaUrl('21178262', 'standard')).rejects.toMatchObject({ status: 503, code: 'source_offline' });
    expect(player).not.toHaveBeenCalled();
  });
});

describe('source failures have distinct error codes', () => {
  it('distinguishes connection and protocol failures from permission failures', async () => {
    player.mockRejectedValue(new Error('private upstream details'));
    await expect(mediaUrl('21178262', 'standard')).rejects.toMatchObject({ status: 502, code: 'source_request_failed' });
    expect(() => mediaData({ code: 200, data: [] })).toThrow(expect.objectContaining({ status: 502, code: 'source_invalid_response' }));
  });
  it('normalizes rejected upstream login and risk-control responses', async () => {
    player.mockRejectedValue({ status: 400, body: { code: -460 } });
    await expect(mediaUrl('21178262', 'standard')).rejects.toMatchObject({ status: 503, code: 'source_risk_control' });
    player.mockRejectedValue({ status: 401, body: { code: 301 } });
    await expect(mediaUrl('21178262', 'standard')).rejects.toMatchObject({ status: 401, code: 'source_login_expired' });
  });
  it('enforces the audio host allowlist for authenticated playback too', () => {
    expect(() => mediaData({ data: [{ ...full, url: 'https://untrusted.invalid/song.mp3' }] })).toThrow();
  });
});
