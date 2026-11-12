import crypto from 'node:crypto';
import fs from 'node:fs';
import { dir } from './config';
import { run } from './db';
import { fail } from './http';
import type { UserRow } from './auth';

export const MAX_AVATAR = 2 * 1024 * 1024;
export const AVATAR_RE = /^\d+-[a-f0-9]{16}\.(png|jpg|webp)$/;

export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
export const avatarMime = (name: string) => (name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

export function saveAvatar(user: UserRow, buf: Buffer) {
  if (buf.length === 0) throw fail(400, '没有收到图片');
  if (buf.length > MAX_AVATAR) throw fail(413, '头像不能超过 2 MB');
  const ext = sniffImage(buf);
  if (!ext) throw fail(400, '头像需要是 PNG、JPG 或 WebP 图片');
  const name = `${user.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(dir('avatars', name), buf, { mode: 0o600 });
  if (user.avatar) fs.rmSync(dir('avatars', user.avatar), { force: true });
  run('UPDATE users SET avatar=? WHERE id=?', name, user.id);
  return name;
}
export function removeAvatar(user: UserRow) {
  if (user.avatar) fs.rmSync(dir('avatars', user.avatar), { force: true });
  run("UPDATE users SET avatar='' WHERE id=?", user.id);
}
