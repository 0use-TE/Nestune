import fs from 'node:fs';
import { windowsPackage } from '@/server/client-updates';
import { fail, route } from '@/server/http';
import { serveFile } from '@/server/media';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, context) => {
  const code = (await context.params).code;
  if (!/^[1-9]\d{0,8}$/.test(code)) throw fail(404, '此版本不存在');
  const file = windowsPackage(Number(code));
  if (!fs.existsSync(file)) throw fail(404, '此版本不存在');
  return serveFile(req, file, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="Nestune-Windows-${code}-Setup.exe"`, 'Cache-Control': 'public, max-age=86400, immutable' });
});
