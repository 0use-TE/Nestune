import fs from 'node:fs';
import { requireUser } from '@/server/auth';
import { AVATAR_RE, avatarMime } from '@/server/avatar';
import { dir } from '@/server/config';
import { fail, route } from '@/server/http';

export const GET = route(async (_req, ctx) => {
  await requireUser();
  const { file } = await ctx.params;
  if (!AVATAR_RE.test(file)) throw fail(404, '头像不存在');
  const p = dir('avatars', file);
  if (!fs.existsSync(p)) throw fail(404, '头像不存在');
  return new Response(fs.readFileSync(p), {
    headers: { 'Content-Type': avatarMime(file), 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
});
