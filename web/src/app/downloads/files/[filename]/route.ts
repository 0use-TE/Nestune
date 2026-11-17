import { clientDownloadFile } from '@/server/client-downloads';
import { fail, route } from '@/server/http';
import { serveFile } from '@/server/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (req, ctx) => {
  const download = clientDownloadFile((await ctx.params).filename);
  if (!download) throw fail(404, '找不到这个客户端安装包');
  const { file, entry } = download;
  return serveFile(req, file, entry.platform === 'android' ? 'application/vnd.android.package-archive' : 'application/octet-stream', {
    'Content-Disposition': `attachment; filename="${entry.filename}"`,
    'Cache-Control': 'public, max-age=3600',
  });
});
