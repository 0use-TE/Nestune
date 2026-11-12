import fs from 'node:fs';
import { parseLrc } from '@/lib/lyrics';
import { dir } from './config';
import { fail } from './http';
import { accessFromPrivilege, type Access } from './quality';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as unknown as { __nt_up?: any; __nt_sess?: Sess; __nt_qr?: Map<string, number>; __nt_epoch?: number; __nt_meta?: Map<string, { v: any; t: number }> };
type Sess = { cookie?: any; ownerId?: number | string; savedAt?: string };

function upstream(): any {
  if (!g.__nt_up) {
    process.env.ENABLE_GENERAL_UNBLOCK = 'false';
    process.env.NETEASE_COOKIE = '';
    process.env.TMP = process.env.TEMP = process.env.TMPDIR = dir('runtime');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    g.__nt_up = require('@neteasecloudmusicapienhanced/api');
  }
  return g.__nt_up;
}

/* ---------- bound account session (server only) ---------- */
const sessionFile = () => dir('session.json');
export function session(): Sess {
  if (!g.__nt_sess) {
    try { g.__nt_sess = JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch { g.__nt_sess = {}; }
  }
  return g.__nt_sess!;
}
function saveSession(next: Sess) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(sessionFile() + '.tmp', JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(sessionFile() + '.tmp', sessionFile());
  g.__nt_sess = next;
  g.__nt_meta?.clear();
}

async function call(name: string, params: Record<string, unknown> = {}, cookie: any = {}) {
  try {
    const b = (await upstream()[name]({ ...params, cookie, timeout: 20000 })).body;
    if (!b || (b.code && b.code !== 200 && ![800, 801, 802, 803].includes(b.code))) {
      throw fail(b?.code === 301 ? 401 : 502, b?.code === 301 ? '音源登录已失效，请管理员重新扫码' : '音源暂时不可用，请稍后重试');
    }
    return b;
  } catch (e: any) {
    if (e?.status) throw e;
    throw fail(502, '音源请求失败，请稍后重试');
  }
}
const withLogin = (name: string, params: Record<string, unknown>) => {
  const s = session();
  if (!s.cookie) throw fail(503, '音源尚未登录，请联系管理员', 'source_offline');
  return call(name, params, s.cookie);
};

/* ---------- admin: QR login ---------- */
const qrKeys = () => (g.__nt_qr ??= new Map());
export async function status() {
  const s = session();
  if (!s.cookie) return { loggedIn: false };
  try {
    const b = await call('login_status', {}, s.cookie);
    if (!b.data?.profile?.userId) return { loggedIn: false, expired: true };
    return { loggedIn: true, savedAt: s.savedAt };
  } catch (e: any) {
    if (e?.status === 401) return { loggedIn: false, expired: true };
    return { loggedIn: true, savedAt: s.savedAt, unreachable: true };
  }
}
export async function qrCreate() {
  const b = await call('login_qr_key');
  const key = b.data?.unikey;
  if (!key) throw fail(502, '无法生成登录二维码');
  const q = await call('login_qr_create', { key, qrimg: true });
  qrKeys().set(key, Date.now() + 180_000);
  return { key, qrimg: q.data.qrimg as string };
}
export async function qrCheck(key: string) {
  const exp = qrKeys().get(key);
  if (!exp || exp < Date.now()) throw fail(410, '二维码已过期，请重新生成');
  const b = await call('login_qr_check', { key });
  if (b.code === 803) {
    if (!String(b.cookie || '').includes('MUSIC_U=')) throw fail(502, '没有收到有效的登录会话');
    const profile = (await call('login_status', {}, b.cookie)).data?.profile;
    if (!profile?.userId) throw fail(502, '登录会话验证失败');
    saveSession({ cookie: b.cookie, ownerId: profile.userId, savedAt: new Date().toISOString() });
    qrKeys().clear();
  }
  if (b.code === 800) qrKeys().delete(key);
  return { code: b.code as number, loggedIn: b.code === 803 };
}
export function logout() { qrKeys().clear(); saveSession({}); }

/* ---------- shaping (field whitelist) ---------- */
const IMG_HOSTS = ['music.126.net', 'music.163.com', 'music.127.net'];
export function cover(u: unknown, size = 400): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const x = new URL(u.replace(/^http:/, 'https:'));
    if (!IMG_HOSTS.some(h => x.hostname === h || x.hostname.endsWith('.' + h))) return null;
    return `${x.origin}${x.pathname}?param=${size}y${size}`;
  } catch { return null; }
}
const QMAP: Record<string, string> = { l: 'standard', m: 'standard', h: 'exhigh', sq: 'lossless', hr: 'hires' };

export function songSummary(s: any, fallbackCover?: string | null, priv?: any) {
  const al = s.al || s.album || {};
  const q = ['l', 'm', 'h', 'sq', 'hr'].filter(k => s[k]).map(k => ({ type: k, level: QMAP[k], bitrate: s[k].br, size: s[k].size }));
  return {
    id: String(s.id),
    name: String(s.name || ''),
    duration: Math.round((s.dt ?? s.duration ?? 0) / 1000),
    artists: (s.ar || s.artists || []).map((a: any) => ({ id: String(a.id), name: String(a.name || '') })),
    album: { id: al.id ? String(al.id) : null, name: String(al.name || '') },
    cover: cover(al.picUrl || al.blurPicUrl) || fallbackCover || null,
    qualities: q,
    fee: s.fee ?? 0,
    access: accessFromPrivilege(priv) as Access,
  };
}
export type Song = ReturnType<typeof songSummary>;

/* ---------- lyrics ---------- */
export { parseLrc };
export function mergeLyrics(lyric: string, translation: string, romanization: string) {
  const base = parseLrc(lyric), tr = parseLrc(translation), ro = parseLrc(romanization);
  const near = (list: { t: number; text: string }[], t: number) => {
    let best: { t: number; text: string } | undefined;
    for (const x of list) if (Math.abs(x.t - t) <= 1 && (!best || Math.abs(x.t - t) < Math.abs(best.t - t))) best = x;
    return best?.text;
  };
  return base.map(l => ({ t: Math.round(l.t * 100) / 100, text: l.text, tr: near(tr, l.t), roma: near(ro, l.t) }));
}

/* ---------- catalog ---------- */
const metaCache = () => (g.__nt_meta ??= new Map());
/** Song details with the bound account's access (playable? best quality?) attached. Cached for an hour. */
export async function songs(ids: string[]): Promise<Song[]> {
  const unique = [...new Set(ids)].slice(0, 100);
  const cache = metaCache(), fresh = Date.now() - 3600_000;
  const missing = unique.filter(i => !(cache.get(i)?.t > fresh && cache.get(i)?.v?.access));
  if (missing.length) {
    const b = await call('song_detail', { ids: missing.join(',') }, session().cookie || {});
    const priv = new Map<string, any>((b.privileges || []).map((p: any) => [String(p.id), p]));
    for (const s of b.songs || []) cache.set(String(s.id), { v: songSummary(s, null, priv.get(String(s.id))), t: Date.now() });
    if (cache.size > 3000) for (const k of [...cache.keys()].slice(0, 500)) cache.delete(k);
  }
  return unique.map(i => cache.get(i)?.v).filter(Boolean);
}
/** Lists that come from other endpoints lack account access info; fill it in with one batched lookup. */
async function withAccess(list: Song[]): Promise<Song[]> {
  if (!list.length) return list;
  try {
    const known = new Map((await songs(list.map(s => s.id))).map(s => [s.id, s.access]));
    return list.map(s => ({ ...s, access: known.get(s.id) ?? s.access }));
  } catch { return list; }
}
export const songMeta = async (id: string): Promise<Song> => {
  const [s] = await songs([id]);
  if (!s) throw fail(404, '找不到这首歌曲');
  return s;
};

export async function search(keywords: string, type: string, limit: number, offset: number) {
  const types: Record<string, number> = { song: 1, album: 10, playlist: 1000, artist: 100 };
  if (!keywords || keywords.length > 100 || !Object.hasOwn(types, type)) throw fail(400, '请输入有效的关键词和搜索类型');
  const b = await call('cloudsearch', { keywords, type: types[type], limit, offset });
  const r = b.result || {};
  let items: any[] = [];
  if (type === 'song') items = await withAccess((r.songs || []).map((s: any) => songSummary(s)));
  if (type === 'album') items = (r.albums || []).map((a: any) => ({ id: String(a.id), name: a.name, cover: cover(a.picUrl), artists: (a.artists || [a.artist]).filter(Boolean).map((x: any) => ({ id: String(x.id), name: x.name })), size: a.size }));
  if (type === 'playlist') items = (r.playlists || []).map((p: any) => ({ id: String(p.id), name: p.name, cover: cover(p.coverImgUrl), trackCount: p.trackCount, playCount: p.playCount }));
  if (type === 'artist') items = (r.artists || []).map((a: any) => ({ id: String(a.id), name: a.name, cover: cover(a.picUrl || a.img1v1Url), albumSize: a.albumSize }));
  return { type, total: r[`${type}Count`] || items.length, items };
}

export async function album(id: string) {
  const b = await call('album', { id });
  const a = b.album || {};
  const c = cover(a.picUrl);
  return {
    album: { id: String(a.id), name: a.name, cover: c, description: a.description || '', publishTime: a.publishTime, size: a.size, artist: a.artist?.name || '' },
    songs: await withAccess((b.songs || []).map((s: any) => songSummary(s, c))),
  };
}

export async function playlist(id: string, limit: number, offset: number) {
  const b = await call('playlist_detail', { id, s: 0 });
  const p = b.playlist;
  if (!p || Number(p.privacy || 0) !== 0 || Number(p.specialType) === 5) throw fail(403, '不提供私人歌单或喜欢列表');
  const owner = session().ownerId;
  if (owner && String(p.creator?.userId) === String(owner)) throw fail(403, '不提供绑定账号的个人歌单');
  const ids = (p.trackIds || []).slice(offset, offset + limit).map((x: any) => String(x.id));
  return {
    playlist: { id: String(p.id), name: p.name, cover: cover(p.coverImgUrl), description: p.description || '', creator: p.creator?.nickname || '', trackCount: p.trackCount, playCount: p.playCount, tags: p.tags || [] },
    songs: ids.length ? await songs(ids) : [],
    limit, offset,
  };
}

export async function artist(id: string) {
  const b = await call('artists', { id });
  const a = b.artist || {};
  return {
    artist: { id: String(a.id), name: a.name, cover: cover(a.picUrl || a.img1v1Url), description: a.briefDesc || '', musicSize: a.musicSize, albumSize: a.albumSize },
    songs: await withAccess((b.hotSongs || []).slice(0, 50).map((s: any) => songSummary(s))),
  };
}

export async function lyrics(id: string) {
  const b = await call('lyric', { id });
  const lyric = b.lrc?.lyric || '', tr = b.tlyric?.lyric || '', ro = b.romalrc?.lyric || '';
  return { id, lines: mergeLyrics(lyric, tr, ro), hasTranslation: !!tr, instrumental: !!b.nolyric };
}

export async function hotSearch() {
  const b = await call('search_hot_detail');
  return (b.data || []).slice(0, 20).map((x: any) => String(x.searchWord)).filter(Boolean);
}
export async function suggest(keywords: string) {
  if (!keywords || keywords.length > 50) throw fail(400, '关键词无效');
  const b = await call('search_suggest', { keywords, type: 'mobile' });
  return (b.result?.allMatch || []).map((x: any) => String(x.keyword)).filter(Boolean).slice(0, 10);
}

export async function home() {
  const safe = async (p: Promise<any>) => { try { return await p; } catch { return {}; } };
  const [pl, ns, tl] = await Promise.all([
    safe(call('personalized', { limit: 12 })), safe(call('personalized_newsong', { limit: 12 })), safe(call('toplist')),
  ]);
  return {
    playlists: (pl.result || []).map((p: any) => ({ id: String(p.id), name: p.name, cover: cover(p.picUrl), playCount: p.playCount })),
    newSongs: await withAccess((ns.result || []).map((x: any) => songSummary({ ...x.song, al: x.song?.album, ar: x.song?.artists, dt: x.song?.duration }, cover(x.picUrl)))),
    charts: (tl.list || []).slice(0, 8).map((p: any) => ({ id: String(p.id), name: p.name, cover: cover(p.coverImgUrl), updateFrequency: p.updateFrequency })),
  };
}

/* ---------- audio source ---------- */
const MEDIA_HOSTS = ['music.126.net', 'music.163.com', 'music.127.net'];
export function assertMediaUrl(raw: string) {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !MEDIA_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) throw fail(502, '上游返回了未识别的音频域名');
  return url;
}
export function mediaData(body: any) {
  const d = Array.isArray(body?.data) ? body.data[0] : body?.data;
  if (!d?.url || d.freeTrialInfo || d.freeTrialPrivilege?.resConsumable || d.code < 0) {
    throw fail(403, '当前音源账号没有这首歌的完整播放权限（会员、购买或版权限制）', 'no_access');
  }
  assertMediaUrl(d.url);
  return d as { url: string; level?: string; type?: string; size?: number; br?: number };
}
export async function mediaUrl(id: string, level: string) {
  return mediaData(await withLogin('song_download_url_v1', { id, level }));
}
export async function available(id: string) {
  try {
    const b = await call('check_music', { id, br: 320000 });
    return { available: !!b.success, message: b.message || '' };
  } catch { return { available: false, message: '无法确认' }; }
}
