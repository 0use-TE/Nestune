import { isQqId } from '@/lib/music-ids';
import { catalogSong } from './catalog';
import { chorus } from './netease';

const markers = new Map<string, { at: number; value: { start: number; end: number } | null }>();
export async function songPreview(user: number, id: string) {
  const song = await catalogSong(user, id);
  let marker = markers.get(id);
  if (!isQqId(id) && /^\d+$/.test(id) && (!marker || marker.at < Date.now() - 3600_000)) {
    const value = await chorus(id).catch(() => null);
    if (markers.size > 2000) markers.clear();
    markers.set(id, marker = { at: Date.now(), value });
  }
  const duration = song.duration > 0 ? song.duration : 180;
  const exact = marker?.value && marker.value.start < duration - 1 ? marker.value : null;
  const start = exact ? exact.start : Math.min(duration * .35, Math.max(0, duration - 16));
  return { start, end: Math.min(duration, start + 15, exact?.end ?? Infinity), method: exact ? 'chorus' : 'excerpt', song };
}
