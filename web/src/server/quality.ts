import { QUALITIES, type Quality } from './config';

export const LEVEL_LABEL: Record<Quality, string> = { standard: '标准', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' };
export const LEVEL_FORMAT: Record<Quality, string> = { standard: 'MP3', exhigh: 'MP3', lossless: 'FLAC', hires: 'FLAC' };

/** What the bound music account may do with one song, taken from the catalog's privilege record. */
export type Access = { playable: boolean; max: Quality | null; reason?: string };

const PLAY_LEVEL: Record<string, Quality | null> = {
  none: null, standard: 'standard', higher: 'standard', exhigh: 'exhigh', lossless: 'lossless',
  hires: 'hires', jyeffect: 'hires', sky: 'hires', dolby: 'hires', jymaster: 'hires',
};

export function accessFromPrivilege(p: any): Access {
  if (!p) return { playable: true, max: 'hires' }; // unknown: do not block, let the real request decide
  if (Number(p.st) < 0) return { playable: false, max: null, reason: '暂无版权' };
  let max: Quality | null | undefined = PLAY_LEVEL[String(p.plLevel)];
  if (max === undefined) max = p.pl >= 999000 ? 'lossless' : p.pl >= 320000 ? 'exhigh' : p.pl > 0 ? 'standard' : null;
  if (!max) return { playable: false, max: null, reason: '当前音源账号没有这首歌的播放权限（会员或购买限制）' };
  return { playable: true, max };
}

export type TierState = 'ok' | 'over_cap' | 'no_access' | 'missing';
export type Tier = { level: Quality; label: string; format: string; bitrate: number | null; size: number | null; state: TierState };

const rank = (q: Quality) => QUALITIES.indexOf(q);

/** Which quality tiers exist for a song and which of them this user can actually get. */
export function tiersFor(qualities: { level: string; bitrate?: number; size?: number }[], access: Access, cap: Quality) {
  const tiers: Tier[] = QUALITIES.map(level => {
    const q = qualities.find(x => x.level === level);
    let state: TierState = 'ok';
    if (!q) state = 'missing';
    else if (!access.playable || !access.max || rank(level) > rank(access.max)) state = 'no_access';
    else if (rank(level) > rank(cap)) state = 'over_cap';
    return { level, label: LEVEL_LABEL[level], format: LEVEL_FORMAT[level], bitrate: q?.bitrate ?? null, size: q?.size ?? null, state };
  });
  const best = [...tiers].reverse().find(t => t.state === 'ok')?.level ?? null;
  return { playable: access.playable, reason: access.reason, tiers, best };
}

export function clampLevel(want: string | null | undefined, cap: Quality, fallback: Quality = 'standard'): Quality {
  const w = QUALITIES.includes(want as never) ? (want as Quality) : fallback;
  return QUALITIES[Math.min(rank(w), rank(cap))];
}
