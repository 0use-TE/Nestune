import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { ACTIVATION_HOURS, ADMIN_SESSION_HOURS, SESSION_DAYS, adminKey } from './config';
import { all, now, one, run } from './db';
import { clientIp, fail } from './http';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export type UserRow = {
  id: number; username: string; display_name: string; bio: string; email: string; avatar: string;
  profile_public?: number; pwd_hash: string; status: 'pending' | 'active' | 'disabled'; act_hash: string; act_expires: number;
  max_quality: string; can_save: number; created_at: number; last_login_at: number;
};

/* ---------- passwords ---------- */
export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [v, s, k] = stored.split('$');
  if (v !== 's1' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const actual = await scrypt(pw, Buffer.from(s, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
export function checkPasswordRule(pw: unknown) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) throw fail(400, '密码长度需要在 8 到 128 位之间');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw fail(400, '密码需要同时包含字母和数字');
  return pw;
}

/* ---------- activation codes ---------- */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode() {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
export const normCode = (c: string) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const codeHash = (c: string) => sha(normCode(c));
export const codeExpiry = () => now() + ACTIVATION_HOURS * 3600_000;

/* ---------- public shapes ---------- */
export function publicUser(u: UserRow) {
  return {
    id: u.id, username: u.username, displayName: u.display_name || u.username, bio: u.bio, email: u.email,
    avatar: u.avatar ? `/api/avatars/${u.avatar}` : null, status: u.status, maxQuality: u.max_quality,
    createdAt: u.created_at, lastLoginAt: u.last_login_at, profilePublic: u.profile_public !== 0,
  };
}

/* ---------- sessions ---------- */
const USER_COOKIE = 'nt_sid';
const ADMIN_COOKIE = 'nt_admin';

function isSecure(req: Request) {
  return req.headers.get('x-forwarded-proto') === 'https' || new URL(req.url).protocol === 'https:';
}

export async function startSession(kind: 'user' | 'admin', userId: number, req: Request) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = kind === 'admin' ? ADMIN_SESSION_HOURS * 3600_000 : SESSION_DAYS * 86400_000;
  run('INSERT INTO sessions(id,kind,user_id,created_at,expires_at,last_seen,ip,ua) VALUES(?,?,?,?,?,?,?,?)',
    sha(token), kind, userId, now(), now() + ttl, now(), clientIp(req), (req.headers.get('user-agent') || '').slice(0, 200));
  (await cookies()).set(kind === 'admin' ? ADMIN_COOKIE : USER_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: isSecure(req), path: '/', maxAge: Math.floor(ttl / 1000),
  });
}

export async function endSession(kind: 'user' | 'admin') {
  const jar = await cookies();
  const name = kind === 'admin' ? ADMIN_COOKIE : USER_COOKIE;
  const token = jar.get(name)?.value;
  if (token) run('DELETE FROM sessions WHERE id=?', sha(token));
  jar.delete(name);
}

type SessionRow = { id: string; user_id: number; expires_at: number; last_seen: number };
async function findSession(kind: 'user' | 'admin') {
  const token = (await cookies()).get(kind === 'admin' ? ADMIN_COOKIE : USER_COOKIE)?.value;
  if (!token || token.length !== 64) return undefined;
  const s = one<SessionRow>('SELECT id,user_id,expires_at,last_seen FROM sessions WHERE id=? AND kind=?', sha(token), kind);
  if (!s) return undefined;
  if (s.expires_at < now()) { run('DELETE FROM sessions WHERE id=?', s.id); return undefined; }
  if (now() - s.last_seen > 60_000) run('UPDATE sessions SET last_seen=? WHERE id=?', now(), s.id);
  return s;
}

async function currentUserSession() {
  const s = await findSession('user');
  if (!s) return undefined;
  const u = one<UserRow>('SELECT * FROM users WHERE id=?', s.user_id);
  return u?.status === 'active' ? { user: u, sessionId: s.id } : undefined;
}
export async function requireUserSession() {
  const session = await currentUserSession();
  if (!session) throw fail(401, '请先登录', 'unauthorized');
  return session;
}
export async function requireUser(): Promise<UserRow> {
  return (await requireUserSession()).user;
}
export async function requireAdmin() {
  if (!adminKey()) throw fail(503, '服务端尚未配置 ADMIN_KEY', 'admin_unconfigured');
  const s = await findSession('admin');
  if (!s) throw fail(401, '需要管理密钥', 'admin_required');
  return s;
}

export const kickUser = (userId: number) => run("DELETE FROM sessions WHERE user_id=? AND kind='user'", userId);
export const onlineCount = () => one<{ n: number }>("SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE kind='user' AND last_seen>? AND expires_at>?", now() - 15 * 60_000, now())!.n;
export const activeSessions = (userId: number) => all('SELECT created_at,last_seen,ip,ua FROM sessions WHERE user_id=? AND kind=\'user\' AND expires_at>? ORDER BY last_seen DESC', userId, now());
