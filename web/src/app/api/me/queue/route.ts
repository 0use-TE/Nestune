import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { catalogId } from '@/server/catalog';
import { one, run } from '@/server/db';
import { body, fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { onlineSongs as songs } from '@/server/catalog';
import { visibleSong } from '@/server/uploads';
import { createShuffle, readShuffle, type ShuffleState } from '@/lib/shuffle';
import { PLAYBACK_MODES, type PlaybackMode } from '@/lib/shared-queue';

type Saved = { ids: string[]; index: number; position: number; mode?: PlaybackMode; shuffle?: ShuffleState };

export const GET = userRoute(async (_req, _ctx, u) => {
  const row = one<{ data: string }>('SELECT data FROM queue WHERE user_id=?', u.id);
  const q: Saved = row ? JSON.parse(row.data) : { ids: [], index: 0, position: 0 };
  const onlineIds = q.ids.filter(id => !isUploadSong(id));
  const online: Song[] = [];
  for (let offset = 0; offset < onlineIds.length; offset += 100) online.push(...await songs(onlineIds.slice(offset, offset + 100)));
  const byId = new Map<string, Song>(online.map(song => [song.id, song]));
  const slots = q.ids.map(id => isUploadSong(id) ? visibleSong(u.id, { id } as Song) : byId.get(id));
  const index = slots.slice(0, q.index).filter(Boolean).length;
  const visible = slots.filter((song): song is Song => !!song);
  return { songs: visible, index, position: slots[q.index] ? q.position : 0,
    mode: PLAYBACK_MODES.includes(q.mode!) ? q.mode : 'off', shuffle: createShuffle(visible, index, q.shuffle) };
});

export const PUT = userRoute(async (req, _ctx, u) => {
  const b = await body<Saved>(req, 131072);
  if (!Array.isArray(b.ids) || b.ids.length > 500) throw fail(400, '队列格式无效');
  const q: Saved = { ids: b.ids.map(catalogId), index: Math.max(0, Math.min(Number(b.index) || 0, b.ids.length)), position: Math.max(0, Number(b.position) || 0) };
  const previous = one<{ data: string }>('SELECT data FROM queue WHERE user_id=?', u.id);
  const old: Partial<Saved> = previous ? JSON.parse(previous.data) : {};
  if (b.mode !== undefined && !PLAYBACK_MODES.includes(b.mode)) throw fail(400, '播放模式无效');
  q.mode = b.mode ?? old.mode ?? 'off';
  q.shuffle = readShuffle(b.shuffle ?? old.shuffle);
  run('INSERT INTO queue(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data', u.id, JSON.stringify(q));
  return { ok: true };
});
