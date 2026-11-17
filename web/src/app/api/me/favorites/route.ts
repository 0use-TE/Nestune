import { uniqueRecordings, recordingAliases } from '@/server/recordings';
import { userRoute } from '@/server/guard';
import { favoriteSongs } from '@/server/playlists';

export const GET = userRoute((_req, _ctx, u) => {
  const songs = favoriteSongs(u.id);
  return { songs: uniqueRecordings(songs), ids: [...new Set(songs.flatMap(s => recordingAliases(s.id)))] };
});
