import fs from 'node:fs';
import crypto from 'node:crypto';
import { QUALITIES, dir } from './config';
import { all, now, one, run } from './db';
import {
  UserRow, checkPasswordRule, codeExpiry, codeHash, hashPassword, kickUser, newCode, normCode, publicUser, verifyPassword,
} from './auth';
import { fail } from './http';
import { clear, hit } from './ratelimit';

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const DUMMY = 's1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export const byId = (id: number) => one<UserRow>('SELECT * FROM users WHERE id=?', id);
export const byName = (name: string) => one<UserRow>('SELECT * FROM users WHERE username=?', name);

export function validQuality(q: unknown) {
  if (!QUALITIES.includes(q as never)) throw fail(400, '不支持的音质');
  return q as string;
}

/* ---------- admin operations ---------- */
export function createUser(input: { username: string; displayName?: string; maxQuality?: string }) {
  const username = String(input.username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw fail(400, '用户名需为 3 到 24 位小写字母、数字或下划线');
  if (byName(username)) throw fail(409, '用户名已存在');
  const code = newCode();
  const display = String(input.displayName || '').trim().slice(0, 24);
  const q = input.maxQuality ? validQuality(input.maxQuality) : 'exhigh';
  const r = run(
    'INSERT INTO users(username,display_name,status,act_hash,act_expires,max_quality,created_at) VALUES(?,?,?,?,?,?,?)',
    username, display, 'pending', codeHash(code), codeExpiry(), q, now());
  return { user: publicUser(byId(Number(r.lastInsertRowid))!), activationCode: code };
}

export function resetUser(id: number) {
  const u = byId(id);
  if (!u) throw fail(404, '用户不存在');
  const code = newCode();
  run("UPDATE users SET status='pending', pwd_hash='', act_hash=?, act_expires=? WHERE id=?", codeHash(code), codeExpiry(), id);
  kickUser(id);
  return { user: publicUser(byId(id)!), activationCode: code };
}

export function updateUser(id: number, patch: { status?: string; maxQuality?: string; displayName?: string }) {
  const u = byId(id);
  if (!u) throw fail(404, '用户不存在');
  if (patch.status !== undefined) {
    if (!['active', 'disabled'].includes(patch.status)) throw fail(400, '无效的状态');
    if (u.status === 'pending' && patch.status === 'active') throw fail(400, '该用户尚未激活，无法直接启用');
    run('UPDATE users SET status=? WHERE id=?', patch.status, id);
    if (patch.status === 'disabled') kickUser(id);
  }
  if (patch.maxQuality !== undefined) run('UPDATE users SET max_quality=? WHERE id=?', validQuality(patch.maxQuality), id);
  if (patch.displayName !== undefined) run('UPDATE users SET display_name=? WHERE id=?', String(patch.displayName).trim().slice(0, 24), id);
  return publicUser(byId(id)!);
}

export function deleteUser(id: number) {
  const u = byId(id);
  if (!u) throw fail(404, '用户不存在');
  if (u.avatar) fs.rmSync(dir('avatars', u.avatar), { force: true });
  run('DELETE FROM users WHERE id=?', id);
}

export function listUsers() {
  return all<UserRow & { favs: number; plays: number }>(`
    SELECT u.*, (SELECT COUNT(*) FROM favorites f WHERE f.user_id=u.id) favs,
           (SELECT COUNT(*) FROM history h WHERE h.user_id=u.id) plays
    FROM users u ORDER BY u.created_at DESC`).map(u => ({ ...publicUser(u), favorites: u.favs, plays: u.plays }));
}

/* ---------- user-facing auth ---------- */
export async function login(username: string, password: string, ip: string) {
  const name = String(username || '').trim().toLowerCase();
  hit(`login:ip:${ip}`, 30, 60_000, '登录尝试过多，请稍后再试');
  hit(`login:user:${name}`, 8, 300_000, '该账号登录尝试过多，请 5 分钟后再试');
  const u = byName(name);
  const ok = await verifyPassword(String(password || ''), u?.pwd_hash || DUMMY);
  if (!u || !ok) throw fail(401, '用户名或密码错误');
  if (u.status === 'disabled') throw fail(403, '账号已被停用，请联系管理员', 'disabled');
  if (u.status === 'pending') throw fail(403, '请先使用激活码设置密码', 'activation_required');
  clear(`login:user:${name}`);
  run('UPDATE users SET last_login_at=? WHERE id=?', now(), u.id);
  return u;
}

export async function activate(username: string, code: string, password: string, ip: string) {
  const name = String(username || '').trim().toLowerCase();
  hit(`act:ip:${ip}`, 20, 60_000, '尝试过多，请稍后再试');
  hit(`act:user:${name}`, 6, 300_000, '激活尝试过多，请 5 分钟后再试');
  const u = byName(name);
  const given = Buffer.from(codeHash(code));
  const stored = Buffer.from(u?.act_hash || '0'.repeat(64));
  const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
  if (!u || !match || u.status !== 'pending' || normCode(code).length !== 12) throw fail(401, '用户名或激活码不正确');
  if (u.act_expires < now()) throw fail(410, '激活码已过期，请联系管理员重新生成', 'code_expired');
  checkPasswordRule(password);
  run("UPDATE users SET pwd_hash=?, status='active', act_hash='', act_expires=0, last_login_at=? WHERE id=?",
    await hashPassword(password), now(), u.id);
  clear(`act:user:${name}`);
  return byId(u.id)!;
}

export async function changePassword(u: UserRow, current: string, next: string) {
  hit(`pwd:${u.id}`, 8, 300_000, '尝试过多，请稍后再试');
  if (!(await verifyPassword(String(current || ''), u.pwd_hash))) throw fail(403, '当前密码不正确');
  checkPasswordRule(next);
  run('UPDATE users SET pwd_hash=? WHERE id=?', await hashPassword(next), u.id);
}
