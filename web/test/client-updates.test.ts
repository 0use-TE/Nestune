import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

let dir: string;
let updates: typeof import('@/server/client-updates');
let downloads: typeof import('@/server/client-downloads');
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-releases-'));
  vi.stubEnv('DATA_DIR', dir);
  updates = await import('@/server/client-updates');
  downloads = await import('@/server/client-downloads');
});
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

it('serves only browsable artifacts explicitly published in the archive index', () => {
  const releaseDir = path.join(dir, 'client-releases');
  fs.mkdirSync(releaseDir, { recursive: true });
  const entry = { version: '1.0.0', build: 17, origin: 'nestune', platform: 'linux', architecture: 'x64',
    filename: 'Nestune.AppImage', size: 3, sha256: 'a'.repeat(64) };
  fs.writeFileSync(path.join(releaseDir, entry.filename), 'app');
  fs.writeFileSync(path.join(releaseDir, 'private.exe'), 'app');
  fs.writeFileSync(path.join(releaseDir, 'downloads.json'), JSON.stringify([
    { ...entry, filename: '../app.db' }, { ...entry, filename: 'private.exe' }, { ...entry, filename: 'missing.AppImage' },
    entry,
  ]));
  expect(downloads.clientDownloads()).toEqual([entry]);
  expect(downloads.clientDownloadFile(entry.filename)?.file).toBe(path.join(releaseDir, entry.filename));
  expect(downloads.clientDownloadFile('private.exe')).toBeNull();
  expect(downloads.clientDownloadFile('downloads.json')).toBeNull();
});

it('picks the newest Windows package independently for x64 and ARM64', () => {
  const entry: import('@/server/client-downloads').ClientDownload = {
    platform: 'windows', architecture: 'x64', version: '1.0.0', origin: 'nestune',
    build: 120, filename: 'windows-x64.exe', size: 12, sha256: 'a'.repeat(64),
  };
  const arm = { ...entry, architecture: 'arm64', build: 119, filename: 'windows-arm64.exe' };
  const older = { ...entry, build: 118, filename: 'old-x64.exe' };
  const legacy = { ...entry, origin: 'music' as const, build: 121, filename: 'legacy-x64.exe' };
  expect(downloads.groupClientDownloads([older, legacy, arm, entry])).toEqual({
    latest: [arm, entry], history: [older, legacy],
  });
});

it('distinguishes Windows installers from portable executables for both architectures and old releases', () => {
  for (const architecture of ['x64', 'arm64']) {
    expect(downloads.clientPackageLabel({ platform: 'windows', filename: `Nestune-1.2.2-Windows-${architecture}-Tauri-Setup.exe` })).toBe('安装版');
    expect(downloads.clientPackageLabel({ platform: 'windows', filename: `Nestune-1.2.2-Windows-${architecture}-Tauri.exe` })).toBe('便携版');
  }
  expect(downloads.clientPackageLabel({ platform: 'windows', filename: 'windows-121.exe' })).toBe('安装版');
  expect(downloads.clientPackageLabel({ platform: 'windows', filename: 'Nestune.msi' })).toBe('安装版');
  expect(downloads.clientPackageLabel({ platform: 'macos', filename: 'Nestune.app.zip' })).toBe('App ZIP');
  expect(downloads.clientPackageLabel({ platform: 'linux', filename: 'Nestune.AppImage' })).toBe('AppImage');
});

it('keeps ARM64 update manifests and executables independent of x64', () => {
  const releaseDir = path.join(dir, 'client-releases');
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const architecture of ['x64', 'arm64'] as const) {
    const bytes = architecture === 'arm64' ? 'arm-binary' : 'x64-binary-size';
    const stem = architecture === 'arm64' ? 'windows-arm64' : 'windows';
    fs.writeFileSync(updates.windowsPackage(122, architecture), bytes);
    fs.writeFileSync(path.join(releaseDir, `${stem}.json`), JSON.stringify({ version: '1.2.2', versionCode: 122, size: bytes.length, sha256: 'a'.repeat(64) }));
    expect(updates.windowsRelease(architecture)?.url).toBe(`/api/client-updates/windows/122${architecture === 'arm64' ? '?arch=arm64' : ''}`);
    expect(updates.windowsRelease(architecture)?.size).toBe(bytes.length);
  }
  fs.unlinkSync(updates.windowsPackage(122, 'arm64'));
  expect(updates.windowsRelease('arm64')).toBeNull();
  expect(updates.windowsRelease()?.size).toBe(15);
});
it('requests updates for the running native executable architecture', async () => {
  const { clientUpdatesUrl } = await import('@/lib/client-updates');
  for (const architecture of ['aarch64', 'arm64']) expect(clientUpdatesUrl({ NestuneDesktop: { architecture } })).toBe('/api/client-updates?windows_arch=arm64');
  for (const architecture of ['x86_64', 'x64', undefined]) expect(clientUpdatesUrl({ NestuneDesktop: { architecture } })).toBe('/api/client-updates');
  expect(clientUpdatesUrl({})).toBe('/api/client-updates');
});
