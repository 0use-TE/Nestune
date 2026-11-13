import fs from 'node:fs';
import { QUALITIES, dir } from './config';
import { all, db, now, one, run } from './db';
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
export function createActivationCode(input: { maxQuality?: string } = {}) {
  const quality = input.maxQuality ? validQuality(input.maxQuality) : 'exhigh';
  const code = newCode();
  const expiresAt = codeExpiry();
  const result = run('INSERT INTO activation_codes(code_hash,max_quality,created_at,expires_at) VALUES(?,?,?,?)', codeHash(code), quality, now(), expiresAt);
  return { id: Number(result.lastInsertRowid), activationCode: code, expiresAt };
}

export function listActivationCodes() {
  return all(`SELECT c.id,c.max_quality AS maxQuality,c.created_at AS createdAt,c.expires_at AS expiresAt,
    u.username,CASE WHEN c.used_at>0 THEN 'used' WHEN c.revoked_at>0 THEN 'revoked'
    WHEN c.expires_at<=? THEN 'expired' ELSE 'unused' END AS status
    FROM activation_codes c LEFT JOIN users u ON u.id=c.used_by ORDER BY c.id DESC`, now());
}

export function revokeActivationCode(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw fail(400, '无效的激活码');
  if (!one('SELECT id FROM activation_codes WHERE id=?', id)) throw fail(404, '激活码不存在');
  run('UPDATE activation_codes SET revoked_at=? WHERE id=? AND used_at=0 AND revoked_at=0', now(), id);
}

function resolveActivation(code: string) {
  if (normCode(code).length !== 12) throw fail(401, '激活码不正确或已失效');
  const hash = codeHash(code);
  const entry = one<{ id: number; max_quality: string; expires_at: number; used_at: number; revoked_at: number }>('SELECT * FROM activation_codes WHERE code_hash=?', hash);
  if (entry) {
    if (entry.used_at || entry.revoked_at) throw fail(401, '激活码不正确或已失效');
    if (entry.expires_at <= now()) throw fail(410, '激活码已过期，请联系管理员重新生成', 'code_expired');
    return { kind: 'register' as const, entry };
  }
  const user = one<UserRow>("SELECT * FROM users WHERE act_hash=? AND status='pending'", hash);
  if (!user) throw fail(401, '激活码不正确或已失效');
  if (user.act_expires <= now()) throw fail(410, '激活码已过期，请联系管理员重新生成', 'code_expired');
  return { kind: 'reset' as const, user };
}

export function checkActivation(code: string, ip: string) {
  hit(`act-check:${ip}`, 20, 60_000, '尝试过多，请稍后再试');
  const result = resolveActivation(code);
  return result.kind === 'register' ? { kind: result.kind } : { kind: result.kind, username: result.user.username, displayName: result.user.display_name || result.user.username };
}

// Kept for compatibility with existing pending accounts; new invitations use createActivationCode.
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

export async function activate(username: string, code: string, password: string, ip: string, displayName?: string) {
  const name = String(username || '').trim().toLowerCase();
  hit(`act:ip:${ip}`, 20, 60_000, '尝试过多，请稍后再试');
  hit(`act:user:${name}`, 6, 300_000, '激活尝试过多，请 5 分钟后再试');
  const initial = resolveActivation(code);
  if (!USERNAME_RE.test(name)) throw fail(400, '用户名需为 3 到 24 位小写字母、数字或下划线');
  const nickname = String(displayName || '').trim();
  if (initial.kind === 'register' && (!nickname || nickname.length > 24)) throw fail(400, '昵称需为 1 到 24 个字符');
  if (initial.kind === 'reset' && initial.user.username !== name) throw fail(401, '用户名或激活码不正确');
  checkPasswordRule(password);
  const passwordHash = await hashPassword(password);
  let id: number;
  db().exec('BEGIN IMMEDIATE');
  try {
    // Recheck after hashing: another request may have consumed, revoked or replaced the code.
    const current = resolveActivation(code);
    if (current.kind === 'register') {
      if (byName(name)) throw fail(409, '用户名已存在，请换一个');
      const result = run("INSERT INTO users(username,display_name,pwd_hash,status,max_quality,created_at,last_login_at) VALUES(?,?,?,'active',?,?,?)", name, nickname, passwordHash, current.entry.max_quality, now(), now());
      id = Number(result.lastInsertRowid);
      run('UPDATE activation_codes SET used_at=?,used_by=? WHERE id=?', now(), id, current.entry.id);
    } else {
      if (current.user.username !== name) throw fail(401, '用户名或激活码不正确');
      id = current.user.id;
      run("UPDATE users SET pwd_hash=?, status='active', act_hash='', act_expires=0, last_login_at=? WHERE id=?", passwordHash, now(), id);
    }
    db().exec('COMMIT');
  } catch (error) {
    db().exec('ROLLBACK');
    throw error;
  }
  clear(`act:user:${name}`);
  return byId(id)!;
}

export async function changePassword(u: UserRow, current: string, next: string) {
  hit(`pwd:${u.id}`, 8, 300_000, '尝试过多，请稍后再试');
  if (!(await verifyPassword(String(current || ''), u.pwd_hash))) throw fail(403, '当前密码不正确');
  checkPasswordRule(next);
  run('UPDATE users SET pwd_hash=? WHERE id=?', await hashPassword(next), u.id);
}
