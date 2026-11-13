import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

let dir: string;
let updates: typeof import('@/server/client-updates');
beforeAll(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-releases-')); vi.stubEnv('DATA_DIR', dir); updates = await import('@/server/client-updates'); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('only advertises a valid available package and ignores supplied download paths', () => {
  expect(updates.androidRelease()).toBeNull();
  fs.mkdirSync(path.join(dir, 'client-releases'));
  fs.writeFileSync(updates.androidPackage(4), 'test-apk');
  const manifest = { version: '1.0.0', versionCode: 4, size: 8, sha256: 'a'.repeat(64), url: 'https://evil.example/file', file: '../../app.db' };
  const file = path.join(dir, 'client-releases/android.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  expect(updates.androidRelease()).toEqual({ version: '1.0.0', versionCode: 4, size: 8, sha256: 'a'.repeat(64), url: '/api/client-updates/android/4' });
  for (const patch of [{ versionCode: '../app.db' }, { versionCode: -1 }, { size: 1 }, { sha256: 'invalid' }, { version: 'unknown' }]) {
    fs.writeFileSync(file, JSON.stringify({ ...manifest, ...patch })); expect(updates.androidRelease()).toBeNull();
  }
  expect(() => updates.androidPackage(NaN)).toThrow(); expect(() => updates.androidPackage(1.5)).toThrow();
});
