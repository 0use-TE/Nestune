import crypto from 'node:crypto';
import { adminKey } from '@/server/config';
import { sha, startSession } from '@/server/auth';
import { body, clientIp, fail, route } from '@/server/http';
import { hit } from '@/server/ratelimit';

/** The admin panel has no accounts: it unlocks only with the ADMIN_KEY from the server environment. */
export const POST = route(async req => {
  const expected = adminKey();
  if (!expected) throw fail(503, '服务端尚未配置 ADMIN_KEY（至少 32 个字符）', 'admin_unconfigured');
  hit(`admin-login:${clientIp(req)}`, 8, 60_000, '尝试过多，请一分钟后再试');
  const given = String((await body<{ key: string }>(req)).key || '');
  const a = Buffer.from(sha(given)), b = Buffer.from(sha(expected));
  if (!crypto.timingSafeEqual(a, b)) throw fail(401, '管理密钥不正确');
  await startSession('admin', 0, req);
  return { ok: true };
});
