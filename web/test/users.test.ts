import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let U: typeof import('@/server/users');
let D: typeof import('@/server/db');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-test-'));
  U = await import('@/server/users');
  D = await import('@/server/db');
});

describe('admin-created accounts', () => {
  it('creates a pending user with a one-time activation code', () => {
    const r = U.createUser({ username: 'Alice', maxQuality: 'lossless' });
    expect(r.user).toMatchObject({ username: 'alice', status: 'pending', maxQuality: 'lossless' });
    expect(r.activationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const row = D.one<{ pwd_hash: string; act_hash: string }>('SELECT pwd_hash, act_hash FROM users WHERE username=?', 'alice')!;
    expect(row.pwd_hash).toBe('');
    expect(row.act_hash).not.toContain(r.activationCode);
  });

  it('rejects bad or duplicate usernames and qualities', () => {
    expect(() => U.createUser({ username: 'a' })).toThrow();
    expect(() => U.createUser({ username: 'bad name' })).toThrow();
    expect(() => U.createUser({ username: 'alice' })).toThrow(/已存在/);
    expect(() => U.createUser({ username: 'bob1', maxQuality: 'ultra' })).toThrow();
  });

  it('blocks login until the user sets their own password', async () => {
    U.createUser({ username: 'carol' });
    await expect(U.login('carol', 'whatever123', 'ip1')).rejects.toMatchObject({ status: 401 });
  });

  it('activates with the code, then the code is dead', async () => {
    const { activationCode } = U.createUser({ username: 'dave' });
    await expect(U.activate('dave', 'AAAA-BBBB-CCCC', 'Passw0rd1', 'ip2')).rejects.toMatchObject({ status: 401 });
    await expect(U.activate('dave', activationCode, 'weak', 'ip2')).rejects.toMatchObject({ status: 400 });
    const u = await U.activate('dave', activationCode, 'Passw0rd1', 'ip2');
    expect(u.status).toBe('active');
    await expect(U.activate('dave', activationCode, 'Another123', 'ip2')).rejects.toMatchObject({ status: 401 });
    expect((await U.login('dave', 'Passw0rd1', 'ip2')).username).toBe('dave');
    await expect(U.login('dave', 'wrongpass1', 'ip2')).rejects.toMatchObject({ status: 401 });
  });

  it('expired codes are refused', async () => {
    const { activationCode } = U.createUser({ username: 'erin' });
    D.run("UPDATE users SET act_expires=1 WHERE username='erin'");
    await expect(U.activate('erin', activationCode, 'Passw0rd1', 'ip3')).rejects.toMatchObject({ status: 410 });
  });

  it('reset wipes the password and requires a new activation', async () => {
    const { activationCode } = U.createUser({ username: 'frank' });
    const u = await U.activate('frank', activationCode, 'Passw0rd1', 'ip4');
    const r = U.resetUser(u.id);
    expect(r.user.status).toBe('pending');
    // the old password no longer works; the error stays generic so it does not reveal account state
    await expect(U.login('frank', 'Passw0rd1', 'ip4')).rejects.toMatchObject({ status: 401 });
    expect((await U.activate('frank', r.activationCode, 'NewPassw0rd2', 'ip4')).status).toBe('active');
  });

  it('disabled users cannot log in and pending users cannot be force-enabled', async () => {
    const { activationCode, user } = U.createUser({ username: 'gina' });
    expect(() => U.updateUser(user.id, { status: 'active' })).toThrow();
    await U.activate('gina', activationCode, 'Passw0rd1', 'ip5');
    U.updateUser(user.id, { status: 'disabled' });
    await expect(U.login('gina', 'Passw0rd1', 'ip5')).rejects.toMatchObject({ status: 403, code: 'disabled' });
  });

  it('locks a username after repeated failures', async () => {
    const { activationCode } = U.createUser({ username: 'hank' });
    await U.activate('hank', activationCode, 'Passw0rd1', 'ip6');
    for (let i = 0; i < 8; i++) await U.login('hank', 'bad-pass-1', 'ip6').catch(() => {});
    await expect(U.login('hank', 'Passw0rd1', 'ip6')).rejects.toMatchObject({ status: 429 });
  });

  it('deleting a user removes their data', async () => {
    const { user } = U.createUser({ username: 'ivy' });
    D.run('INSERT INTO favorites(user_id,song_id,meta,created_at) VALUES(?,?,?,?)', user.id, '1', '{}', 1);
    U.deleteUser(user.id);
    expect(D.one('SELECT 1 x FROM favorites WHERE user_id=?', user.id)).toBeUndefined();
    expect(D.one('SELECT 1 x FROM users WHERE id=?', user.id)).toBeUndefined();
  });

  it('settings are validated and persisted', () => {
    expect(D.saveSettings({ rateLimitPerMin: 200 }).rateLimitPerMin).toBe(200);
    expect(() => D.saveSettings({ rateLimitPerMin: -5 })).toThrow();
    expect(D.settings().rateLimitPerMin).toBe(200);
  });
});

describe('user playlists', () => {
  it('are private to their owner', async () => {
    const P = await import('@/server/playlists');
    const a = U.createUser({ username: 'plA' }).user.id, b = U.createUser({ username: 'plB' }).user.id;
    const p = P.createPlaylist(a, '  通勤  ', '早高峰');
    expect(p).toMatchObject({ name: '通勤', trackCount: 0 });
    expect(P.listPlaylists(a)).toHaveLength(1);
    expect(P.listPlaylists(b)).toHaveLength(0);
    expect(() => P.getPlaylist(b, p.id)).toThrow(/不存在/);
    expect(() => P.updatePlaylist(b, p.id, { name: 'x' })).toThrow();
    expect(() => P.deletePlaylist(b, p.id)).toThrow();
    expect(P.updatePlaylist(a, p.id, { name: '晨间' }).name).toBe('晨间');
    expect(() => P.createPlaylist(a, '   ')).toThrow();
    P.deletePlaylist(a, p.id);
    expect(P.listPlaylists(a)).toHaveLength(0);
  });
});
