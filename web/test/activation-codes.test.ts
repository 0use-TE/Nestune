import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let U: typeof import('@/server/users');
let D: typeof import('@/server/db');
beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-invitations-'));
  U = await import('@/server/users');
  D = await import('@/server/db');
});

describe('unbound activation codes', () => {
  it('generates an invitation without creating an account or exposing stored secrets', () => {
    const code = U.createActivationCode({ maxQuality: 'lossless' });
    expect(U.listUsers()).toHaveLength(0);
    expect(U.checkActivation(code.activationCode, 'check1')).toEqual({ kind: 'register' });
    expect(U.checkActivation(code.activationCode, 'check1')).toEqual({ kind: 'register' });
    expect(U.listActivationCodes()[0]).toMatchObject({ id: code.id, maxQuality: 'lossless', status: 'unused' });
    expect(JSON.stringify(U.listActivationCodes())).not.toContain(code.activationCode);
    expect(JSON.stringify(U.listActivationCodes())).not.toContain('code_hash');
    expect(() => U.createActivationCode({ maxQuality: 'bogus' })).toThrow();
  });

  it('registers chosen credentials, inherits quality, logs in and rejects reuse even after account deletion', async () => {
    const code = U.createActivationCode({ maxQuality: 'hires' });
    const user = await U.activate('Chosen_User', code.activationCode, 'Password123', 'register1', '我的昵称');
    expect(user).toMatchObject({ username: 'chosen_user', display_name: '我的昵称', status: 'active', max_quality: 'hires' });
    expect((await U.login('chosen_user', 'Password123', 'login1')).id).toBe(user.id);
    expect(U.listActivationCodes().find(c => c.id === code.id)).toMatchObject({ status: 'used', username: 'chosen_user' });
    await expect(U.activate('another', code.activationCode, 'Password123', 'reuse', '另一位')).rejects.toMatchObject({ status: 401 });
    U.deleteUser(user.id);
    expect(() => U.checkActivation(code.activationCode, 'deleted')).toThrow();
    expect(U.listActivationCodes().find(c => c.id === code.id)).toMatchObject({ status: 'used', username: null });
  });

  it('keeps the code usable after invalid fields, password or a conflicting username', async () => {
    U.createUser({ username: 'taken_user' });
    const code = U.createActivationCode();
    await expect(U.activate('a', code.activationCode, 'Password123', 'fields1', '昵称')).rejects.toMatchObject({ status: 400 });
    await expect(U.activate('valid_user', code.activationCode, 'weak', 'fields2', '昵称')).rejects.toMatchObject({ status: 400 });
    await expect(U.activate('valid_user', code.activationCode, 'Password123', 'fields3', '  ')).rejects.toMatchObject({ status: 400 });
    await expect(U.activate('taken_user', code.activationCode, 'Password123', 'fields4', '昵称')).rejects.toMatchObject({ status: 409 });
    expect(U.checkActivation(code.activationCode, 'fields5')).toEqual({ kind: 'register' });
    expect((await U.activate('valid_user', code.activationCode, 'Password123', 'fields6', '昵称')).status).toBe('active');
  });

  it('rejects expired and revoked codes without creating users', async () => {
    const expired = U.createActivationCode();
    D.run('UPDATE activation_codes SET expires_at=1 WHERE id=?', expired.id);
    expect(() => U.checkActivation(expired.activationCode, 'expire1')).toThrow(/过期/);
    await expect(U.activate('expired_user', expired.activationCode, 'Password123', 'expire2', '昵称')).rejects.toMatchObject({ status: 410 });
    const revoked = U.createActivationCode();
    U.revokeActivationCode(revoked.id);
    await expect(U.activate('revoked_user', revoked.activationCode, 'Password123', 'revoke1', '昵称')).rejects.toMatchObject({ status: 401 });
    expect(U.byName('revoked_user')).toBeUndefined();
  });

  it('allows only one concurrent redemption', async () => {
    const code = U.createActivationCode();
    const outcomes = await Promise.allSettled([
      U.activate('concurrent_a', code.activationCode, 'Password123', 'race1', '甲'),
      U.activate('concurrent_b', code.activationCode, 'Password123', 'race2', '乙'),
    ]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([U.byName('concurrent_a'), U.byName('concurrent_b')].filter(Boolean)).toHaveLength(1);
  });

  it('rechecks revocation after asynchronous password hashing', async () => {
    const code = U.createActivationCode();
    const pending = U.activate('revoked_during_hash', code.activationCode, 'Password123', 'race3', '昵称');
    U.revokeActivationCode(code.id);
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(U.byName('revoked_during_hash')).toBeUndefined();
  });

  it('preserves the losing code when different invitations choose the same username', async () => {
    const codes = [U.createActivationCode(), U.createActivationCode()];
    const results = await Promise.allSettled(codes.map((code, i) => U.activate('same_username', code.activationCode, 'Password123', `conflict${i}`, '昵称')));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const unused = codes[results.findIndex(r => r.status === 'rejected')];
    expect(U.checkActivation(unused.activationCode, 'conflict-check').kind).toBe('register');
  });

  it('supports existing bound codes and prevents concurrent password resets', async () => {
    const old = U.createUser({ username: 'legacy_user', displayName: '旧昵称' });
    expect(U.checkActivation(old.activationCode, 'legacy-check')).toMatchObject({ kind: 'reset', username: 'legacy_user' });
    const results = await Promise.allSettled([
      U.activate('legacy_user', old.activationCode, 'Password123', 'legacy1'),
      U.activate('legacy_user', old.activationCode, 'Another123', 'legacy2'),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(U.byName('legacy_user')?.display_name).toBe('旧昵称');
    const reset = U.resetUser(old.user.id);
    expect(U.checkActivation(reset.activationCode, 'reset-check')).toMatchObject({ kind: 'reset', username: 'legacy_user' });
    await U.activate('legacy_user', reset.activationCode, 'Resetpass123', 'reset1');
    expect((await U.login('legacy_user', 'Resetpass123', 'reset-login')).id).toBe(old.user.id);
  });
});
