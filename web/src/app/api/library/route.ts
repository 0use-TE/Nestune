import { fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { listLibrary } from '@/server/library';

export const GET = userRoute(() => {
  const songs = listLibrary();
  return { songs, ids: songs.map(s => s.id), totalBytes: songs.reduce((n, s) => n + s.size, 0) };
});

export const POST = userRoute(() => {
  throw fail(410, '请刷新页面，使用「下载到设备」');
});
