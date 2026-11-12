import { all } from '@/server/db';
import { userRoute } from '@/server/guard';

export const GET = userRoute((_req, _ctx, u) => {
  const rows = all<{ meta: string; created_at: number }>('SELECT meta,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC', u.id);
  const songs = rows.map(r => ({ ...JSON.parse(r.meta), favoritedAt: r.created_at }));
  return { songs, ids: songs.map(s => s.id) };
});
