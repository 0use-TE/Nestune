import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

export type AndroidRelease = { version: string; versionCode: number; size: number; sha256: string; url: string };
export function androidRelease(): AndroidRelease | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'client-releases/android.json'), 'utf8'));
    if (!/^\d+\.\d+\.\d+$/.test(value.version) || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || value.versionCode > 999999999 || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
    const file = androidPackage(value.versionCode);
    const size = fs.statSync(file).size;
    if (size !== value.size) return null;
    return { version: value.version, versionCode: value.versionCode, size, sha256: value.sha256, url: `/api/client-updates/android/${value.versionCode}` };
  } catch { return null; }
}
export function androidPackage(code: number) {
  if (!Number.isSafeInteger(code) || code < 1 || code > 999999999) throw new Error('Invalid Android version');
  return path.join(DATA_DIR, 'client-releases', `android-${code}.apk`);
}
