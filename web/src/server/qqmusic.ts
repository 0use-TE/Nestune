import { parseWordLyrics } from '@/lib/karaoke';
import fs from 'node:fs';
import { isQqId, normalizeIsrc } from '@/lib/music-ids';
import type { Song } from '@/lib/types';
import { dir } from './config';
import { fail, HttpError } from './http';
import { mergeLyrics } from './netease';

type Credential = Record<string, string | number>;
const fields = ['musicid', 'musickey', 'openid', 'refresh_token', 'access_token', 'expired_at', 'unionid', 'str_musicid', 'refresh_key'] as const;
const g = globalThis as unknown as { __qq_meta?: Map<string, { value: any; at: number }>; __qq_refresh?: Promise<void>; __qq_qr?: Map<string, { type: string; expires: number }> };
export const qqConfigured = () => !!process.env.QQMUSIC_URL;
function credential(): Credential {
  try { return JSON.parse(fs.readFileSync(dir('qq-session.json'), 'utf8')); } catch { return {}; }
}
function saveCredential(c: Credential) {
  if (!c.musicid || !c.musickey) throw fail(502, 'QQ 音乐没有返回有效的登录凭据');
  const safe = Object.fromEntries(fields.filter(k => c[k] !== undefined).map(k => [k, c[k]]));
  cookieHeader(safe);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(dir('qq-session.json.tmp'), JSON.stringify(safe), { mode: 0o600 });
  fs.chmodSync(dir('qq-session.json.tmp'), 0o600);
  fs.renameSync(dir('qq-session.json.tmp'), dir('qq-session.json'));
  g.__qq_meta?.clear();
}
export function cookieHeader(c: Credential) {
  return fields.filter(k => c[k] !== undefined && c[k] !== '').map(k => {
    const value = String(c[k]);
    if (/[\r\n;\x00-\x1f\x7f]/.test(value)) throw fail(502, 'QQ 音乐登录凭据无效');
    return `${k}=${value}`;
  }).join('; ');
}
async function call(path: string, params: Record<string, string | number | boolean> = {}, c = credential()): Promise<any> {
  if (!qqConfigured()) throw fail(503, 'QQ 音乐尚未配置', 'qq_offline');
  const url = new URL(path, process.env.QQMUSIC_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const response = await fetch(url, { headers: { Cookie: cookieHeader(c) }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const b = await response.json();
    if (!response.ok || b.code !== 0) throw fail(response.status === 401 ? 401 : 502,
      response.status === 401 ? 'QQ 音乐登录已失效，请管理员重新扫码' : 'QQ 音乐请求失败，请稍后重试', response.status === 401 ? 'qq_login_expired' : 'qq_request_failed');
    return b.data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw fail(502, 'QQ 音乐服务暂时无法连接', 'qq_unreachable');
  }
}
async function authenticated(path: string, params: Record<string, string | number | boolean> = {}) {
  let c = credential();
  if (!c.musicid || !c.musickey) throw fail(503, 'QQ 音乐尚未登录，请联系管理员', 'qq_offline');
  if (Number(c.expired_at) > 0 && Number(c.expired_at) * 1000 < Date.now() + 300_000) {
    if (!g.__qq_refresh) g.__qq_refresh = call('/login/refresh_credential', {}, c).then(saveCredential).finally(() => { g.__qq_refresh = undefined; });
    await g.__qq_refresh; c = credential();
  }
  return call(path, params, c);
}
const mid = (id: string) => { if (!isQqId(id)) throw fail(400, 'QQ 音乐编号无效'); return id.slice(3); };
const clean = (s: unknown) => String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, 500);
const qqId = (s: unknown) => /^[a-zA-Z0-9]{1,64}$/.test(String(s || '')) ? `qq-${s}` : '';
export const qqCover = (id: unknown) => /^[a-zA-Z0-9_]{1,80}$/.test(String(id || '')) ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${id}.jpg` : null;
export function assertQqMediaUrl(raw: string) {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port) ||
    !(url.hostname === 'qqmusic.qq.com' || url.hostname.endsWith('.qqmusic.qq.com'))) throw fail(502, 'QQ 音乐返回了未识别的音频域名');
  return url;
}
export function qqSong(s: any): Song {
  const qualities = [['standard', 'size_128mp3', 128000], ['exhigh', 'size_320mp3', 320000], ['lossless', 'size_flac', 0]] as const;
  const name = clean(s.name || s.title), subtitle = clean(s.subtitle);
  return { id: qqId(s.mid), provider: 'qq', name: subtitle && !name.includes(subtitle) ? `${name} (${subtitle})` : name,
    recordingTitle: name, isrc: normalizeIsrc(s.isrc) ?? normalizeIsrc(s.isrcCode),
    duration: Number(s.interval) || 0, artists: (s.singer || []).map((x: any) => ({ id: qqId(x.mid), name: clean(x.name) })),
    album: { id: qqId(s.album?.mid) || null, name: clean(s.album?.name) }, cover: qqCover(s.album?.pmid || s.album?.mid),
    qualities: qualities.filter(([, key]) => Number(s.file?.[key]) > 0).map(([level, key, bitrate]) => ({ level, size: Number(s.file[key]), ...(bitrate ? { bitrate } : {}) })),
    // Pay flags describe the requirement, not this account's current entitlement.
    access: { playable: true, max: 'lossless' }, fee: s.pay?.pay_play ? 1 : 0 };
}
export async function qqSearch(keyword: string, limit: number, offset: number) {
  // The upstream paginates by page, so keep num constant for a search session.
  const page = Math.floor(offset / limit) + 1;
  const data = await call('/search/search_by_type', { keyword, search_type: 0, num: limit, page, highlight: false });
  return { type: 'song', items: (data.song || []).map(qqSong).filter((s: Song) => s.id), total: Number(data.total_num) || 0 };
}
async function rawSong(id: string) {
  const cache = (g.__qq_meta ??= new Map());
  if ((cache.get(id)?.at || 0) > Date.now() - 3600_000) return cache.get(id)!.value;
  const data = await call(`/song/${mid(id)}/detail`);
  if (!data?.track?.mid) throw fail(404, '找不到这首 QQ 音乐歌曲');
  if (cache.size > 2000) cache.clear();
  cache.set(id, { value: data.track, at: Date.now() });
  return data.track;
}
export const qqSongMeta = async (id: string) => qqSong(await rawSong(id));
export async function qqLyrics(id: string) {
  const data = await call(`/song/${mid(id)}/lyric`, { qrc: true, trans: true, roma: true }).catch(() => call(`/song/${mid(id)}/lyric`));
  const lines = mergeLyrics(data.lyric || '', data.trans || '', data.roma || '', parseWordLyrics(data.lyric || '', 'qrc'));
  return { id, lines, hasTranslation: !!data.trans, instrumental: !data.lyric };
}
export function qqMediaData(data: any, level: string) {
  const items = data?.data;
  const item = Array.isArray(items) && items.find((x: any) => x.result === 0 && typeof x.purl === 'string' && x.purl && !x.ekey);
  if (!item) throw fail(403, 'QQ 音乐账号没有这首歌的完整播放权限（会员、购买或版权限制）', 'qq_no_access');
  const url = /^https?:\/\//.test(item.purl) ? item.purl : new URL(item.purl, 'https://isure.stream.qqmusic.qq.com/').href;
  const parsed = assertQqMediaUrl(url);
  const expected = level === 'lossless' ? /^F000[a-zA-Z0-9]+\.flac$/ : level === 'exhigh' ? /^M800[a-zA-Z0-9]+\.mp3$/ : /^M500[a-zA-Z0-9]+\.mp3$/;
  if (!expected.test(parsed.pathname.split('/').pop() || '')) throw fail(403, 'QQ 音乐没有返回所选音质的完整文件', 'qq_no_access');
  return { url, level, type: level === 'lossless' ? 'flac' : 'mp3' };
}
export async function qqMediaUrl(id: string, level: string) {
  const raw = await rawSong(id);
  // Public, unencrypted formats documented by QQMusicApi v0.9.0.
  const levels: Record<string, number> = { standard: 13, exhigh: 12, lossless: 7 };
  const actual = Object.hasOwn(levels, level) ? level : 'lossless';
  return qqMediaData(await authenticated(`/song/${mid(id)}/url`, { file_type: levels[actual], song_type: raw.type || 0, media_mid: raw.file?.media_mid || mid(id) }), actual);
}
export async function qqAlbum(id: string) {
  const [detail, tracks] = await Promise.all([call(`/album/${mid(id)}/detail`), call(`/album/${mid(id)}/songs`, { num: 500, page: 1 })]);
  const a = detail.album || {};
  return { album: { id, name: clean(a.name), cover: qqCover(a.pmid || a.mid || mid(id)), description: clean(a.desc || a.intro), size: tracks.total_num, artist: (detail.singers || []).map((x: any) => clean(x.name)).join(' / '), provider: 'qq' }, songs: (tracks.song_list || []).map(qqSong) as Song[] };
}
export async function qqArtistSongs(id: string, limit: number, offset: number) {
  const data = await call(`/singer/${mid(id)}/songs`, { num: limit, page: Math.floor(offset / limit) + 1, order: 1 });
  const songs: Song[] = (data.song_list || []).map(qqSong);
  const total = Number(data.total_num) || 0;
  return { songs, total, more: offset + songs.length < total, offset, limit };
}
export async function qqArtist(id: string) {
  const [info, tracks] = await Promise.all([call(`/singer/${mid(id)}/info`), qqArtistSongs(id, 50, 0)]);
  const singer = info.singer || {};
  return { artist: { id, name: clean(singer.name), cover: `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid(id)}.jpg`, description: clean(info.base_info?.desc), musicSize: tracks.total, albumSize: 0, provider: 'qq' }, songs: tracks.songs };
}
export async function qqStatus() {
  const c = credential();
  if (!qqConfigured() || !c.musickey) return { configured: qqConfigured(), loggedIn: false };
  try { await authenticated('/user/get_vip_info'); return { configured: true, loggedIn: true }; }
  catch (e) { return { configured: true, loggedIn: false, expired: e instanceof HttpError && e.status === 401, unreachable: e instanceof HttpError && e.status !== 401 }; }
}
export async function qqQrCreate(type: 'qq' | 'wx') {
  const qr = await call(`/login/qrcode/${type}`, {}, {});
  if (!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(qr.img || '') || typeof qr.identifier !== 'string') throw fail(502, 'QQ 登录二维码无效');
  const keys = (g.__qq_qr ??= new Map());
  for (const [key, qr] of keys) if (qr.expires < Date.now()) keys.delete(key);
  if (keys.size > 30) keys.clear();
  keys.set(qr.identifier, { type, expires: Date.now() + 180_000 });
  return { key: qr.identifier, qrimg: qr.img };
}
export async function qqQrCheck(key: string) {
  const qr = g.__qq_qr?.get(key);
  if (!qr || qr.expires < Date.now()) throw fail(410, 'QQ 登录二维码已过期，请重新生成');
  const data = await call(`/login/qrcode/${qr.type}/status`, { identifier: key }, {});
  if (data.event === 0 && data.credential) { saveCredential(data.credential); g.__qq_qr?.clear(); }
  return { code: data.event === 0 ? 803 : data.event === 2 ? 802 : data.event === 1 ? 801 : 800, loggedIn: data.event === 0 };
}
export function qqLogout() { fs.rmSync(dir('qq-session.json'), { force: true }); g.__qq_meta?.clear(); g.__qq_qr?.clear(); }
