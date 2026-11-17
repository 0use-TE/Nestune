import fs from 'node:fs';
import path from 'node:path';
import { dir } from './config';

export const DOWNLOAD_PLATFORMS = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  android: 'Android',
} as const;
export type DownloadPlatform = keyof typeof DOWNLOAD_PLATFORMS;

export type ClientDownload = {
  platform: DownloadPlatform;
  architecture: string;
  version: string;
  build: number;
  origin: 'music' | 'nestune';
  filename: string;
  size: number;
  sha256: string;
};

const extensions: Record<DownloadPlatform, RegExp> = {
  windows: /\.(exe|msi)$/,
  linux: /\.(AppImage|deb|rpm)$/,
  macos: /\.(dmg|zip)$/,
  android: /\.apk$/,
};
const releaseDir = () => dir('client-releases');

function validDownload(entry: unknown): entry is ClientDownload {
  if (!entry || typeof entry !== 'object') return false;
  const value = entry as ClientDownload;
  return Object.hasOwn(DOWNLOAD_PLATFORMS, value.platform) &&
    typeof value.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.filename) &&
    extensions[value.platform].test(value.filename) &&
    typeof value.architecture === 'string' && /^(x64|arm64|universal)$/.test(value.architecture) &&
    typeof value.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.version) &&
    Number.isSafeInteger(value.build) && value.build > 0 &&
    (value.origin === 'music' || value.origin === 'nestune') &&
    Number.isSafeInteger(value.size) && value.size > 0 &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}

export function clientDownloads(): ClientDownload[] {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(releaseDir(), 'downloads.json'), 'utf8')); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  const found = new Map<string, ClientDownload>();
  for (const entry of raw) {
    if (!validDownload(entry) || found.has(entry.filename)) continue;
    try {
      const file = fs.lstatSync(path.join(releaseDir(), entry.filename));
      if (file.isFile() && file.size === entry.size) found.set(entry.filename, entry);
    } catch { /* An unpublished or missing package is excluded. */ }
  }
  return [...found.values()].sort((a, b) => b.build - a.build);
}

export function clientDownloadFile(filename: string) {
  const entry = clientDownloads().find(download => download.filename === filename);
  return entry ? { entry, file: path.join(releaseDir(), entry.filename) } : null;
}

export function groupClientDownloads(downloads: ClientDownload[]) {
  const newestBuild = new Map<string, number>();
  const key = (download: ClientDownload) => `${download.platform}:${download.architecture}`;
  for (const download of downloads) {
    if (download.origin === 'nestune') {
      const target = key(download);
      newestBuild.set(target, Math.max(download.build, newestBuild.get(target) ?? 0));
    }
  }
  const latest: ClientDownload[] = [], history: ClientDownload[] = [];
  for (const download of downloads) {
    const current = download.origin === 'nestune' && newestBuild.get(key(download)) === download.build;
    (current ? latest : history).push(download);
  }
  return { latest, history };
}

export const clientDownloadUrl = (filename: string) => `/downloads/files/${encodeURIComponent(filename)}`;

export function clientPackageLabel(download: Pick<ClientDownload, 'platform' | 'filename'>) {
  const { platform, filename } = download;
  if (platform === 'windows') {
    return /\.msi$/i.test(filename) || /-setup\.exe$|^windows-\d+\.exe$/i.test(filename) ? '安装版' : '便携版';
  }
  if (filename.endsWith('.app.zip')) return 'App ZIP';
  if (filename.endsWith('.AppImage')) return 'AppImage';
  return filename.split('.').at(-1)?.toUpperCase() ?? '下载';
}
