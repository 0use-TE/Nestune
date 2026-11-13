import { publicUser } from '@/server/auth';
import { one, run } from '@/server/db';
import { body, fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { byId } from '@/server/users';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const GET = userRoute(async (_req, _ctx, u) => {
  const favorites = one<{ n: number }>('SELECT COUNT(*) n FROM favorites WHERE user_id=?', u.id)!.n;
  const plays = one<{ n: number }>('SELECT COUNT(*) n FROM history WHERE user_id=?', u.id)!.n;
  return { user: publicUser(u), stats: { favorites, plays } };
});

export const PATCH = userRoute(async (req, _ctx, u) => {
  const b = await body<{ displayName?: string; bio?: string; email?: string; profilePublic?: boolean }>(req);
  if (b.profilePublic !== undefined) {
    if (typeof b.profilePublic !== 'boolean') throw fail(400, '公开设置无效');
    run('UPDATE users SET profile_public=? WHERE id=?', Number(b.profilePublic), u.id);
  }
  if (b.displayName !== undefined) {
    const v = String(b.displayName).trim();
    if (v.length < 1 || v.length > 24) throw fail(400, '昵称长度需要在 1 到 24 之间');
    run('UPDATE users SET display_name=? WHERE id=?', v, u.id);
  }
  if (b.bio !== undefined) {
    const v = String(b.bio).trim();
    if (v.length > 140) throw fail(400, '简介不能超过 140 个字');
    run('UPDATE users SET bio=? WHERE id=?', v, u.id);
  }
  if (b.email !== undefined) {
    const v = String(b.email).trim();
    if (v && !EMAIL_RE.test(v)) throw fail(400, '邮箱格式不正确');
    run('UPDATE users SET email=? WHERE id=?', v, u.id);
  }
  return { user: publicUser(byId(u.id)!) };
});
