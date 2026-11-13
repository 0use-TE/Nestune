import fs from 'node:fs';
import { androidPackage } from '@/server/client-updates';
import { fail, route } from '@/server/http';
import { serveFile } from '@/server/media';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, context) => {
  const code = (await context.params).code;
  if (!/^[1-9]\d{0,8}$/.test(code)) throw fail(404, '此版本不存在');
  const file = androidPackage(Number(code));
  if (!fs.existsSync(file)) throw fail(404, '此版本不存在');
  return serveFile(req, file, 'application/vnd.android.package-archive', { 'Content-Disposition': `attachment; filename="Nestune-1.0.0-Android-${code}.apk"`, 'Cache-Control': 'public, max-age=86400, immutable' });
});
