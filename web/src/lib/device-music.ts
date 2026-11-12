'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ART_EXTENSION, embedDeviceTags, MAX_ART_BYTES, readDeviceTags } from './device-tags';
import { formatLrc, parseLrc } from './lyrics';
import type { LyricLine, Song } from './types';
import { isUploadSong } from './upload-types';

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|wav|ogg|oga|opus|webm)$/i;
const COMPANION_EXT = /\.(jpg|jpeg|png|webp|lrc|txt)$/i;
const MAX_LYRIC_BYTES = 128 * 1024;
const PERMISSION = { mode: 'readwrite' } as const;
type MusicFolder = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(options: typeof PERMISSION): Promise<PermissionState>;
  requestPermission(options: typeof PERMISSION): Promise<PermissionState>;
};
type MusicWindow = Window & { showDirectoryPicker?: (options: typeof PERMISSION & { startIn: 'music' }) => Promise<MusicFolder> };
type DeviceTrack = { song: Song; file: FileSystemFileHandle; lyric?: FileSystemFileHandle; stamp?: string };
type Status = 'loading' | 'insecure' | 'unsupported' | 'authorize' | 'ready' | 'error';

export const isDeviceSong = (id: string) => id.startsWith('device:');

async function folderRecord(candidate?: MusicFolder) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nestune-device-music', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folders');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<MusicFolder | undefined>((resolve, reject) => {
      const tx = db.transaction('folders', candidate ? 'readwrite' : 'readonly');
      const store = tx.objectStore('folders');
      const lookup = store.get('music');
      let selected: MusicFolder | undefined;
      lookup.onsuccess = () => {
        selected = lookup.result ?? candidate;
        if (!lookup.result && candidate) store.add(candidate, 'music');
      };
      tx.oncomplete = () => resolve(selected);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function listTracks(root: MusicFolder, previous: Map<string, DeviceTrack>, isCurrent: () => boolean) {
  const tracks = new Map<string, DeviceTrack>();
  const folders = [{ folder: root, prefix: '' }];
  while (folders.length && isCurrent()) {
    const { folder, prefix } = folders.pop()!;
    const files = new Map<string, FileSystemFileHandle>();
    for await (const entry of folder.values()) {
      if (entry.kind === 'directory') {
        folders.push({ folder: entry as MusicFolder, prefix: `${prefix}${entry.name}/` });
      } else if (AUDIO_EXT.test(entry.name) || COMPANION_EXT.test(entry.name)) files.set(entry.name, entry as FileSystemFileHandle);
    }
    const caseFolded = new Map([...files].map(([name, file]) => [name.toLowerCase(), file]));
    const match = (name: string) => files.get(name) ?? caseFolded.get(name.toLowerCase());
    const audioFiles = [...files.values()].filter(file => AUDIO_EXT.test(file.name));
    for (let i = 0; i < audioFiles.length && isCurrent(); i += 6) {
      await Promise.all(audioFiles.slice(i, i + 6).map(async handle => {
        const name = handle.name.replace(AUDIO_EXT, '');
        const id = `device:${prefix}${handle.name}`;
        const fallback: Song = { id, name, artists: [], album: { id: null, name: '' }, duration: 0, cover: null };
        const lyric = match(`${name}.lrc`) ?? match(`${name}.txt`);
        const image = ['jpg', 'jpeg', 'png', 'webp'].map(ext => match(`${name}.${ext}`)).find(Boolean);
        const [file, sidecar] = await Promise.all([handle.getFile().catch(() => undefined), image?.getFile().catch(() => undefined)]);
        if (!file) { tracks.set(id, { song: fallback, file: handle, lyric }); return; }
        const stamp = JSON.stringify([file.lastModified, file.size, sidecar?.name, sidecar?.lastModified, sidecar?.size]);
        const cached = previous.get(id);
        const song = cached?.stamp === stamp ? cached.song : await readDeviceTags(file, sidecar, fallback);
        tracks.set(id, { song, file: handle, lyric, stamp });
      }));
    }
  }
  return tracks;
}

function fileBase(song: Song) {
  const title = [song.name, song.artists.map(artist => artist.name).join('、')].filter(Boolean).join(' - ');
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/, '') || 'Nestune';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
}

async function unusedStem(folder: MusicFolder, base: string) {
  const stems = new Set<string>();
  for await (const entry of folder.values()) {
    if (AUDIO_EXT.test(entry.name) || COMPANION_EXT.test(entry.name)) stems.add(entry.name.replace(/\.[^.]+$/, '').toLowerCase());
  }
  let stem = base;
  for (let index = 2; stems.has(stem.toLowerCase()); index++) stem = `${base} (${index})`;
  return stem;
}

async function writeFile(handle: FileSystemFileHandle, data: Blob) {
  const writer = await handle.createWritable();
  try { await writer.write(data); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

async function fetchCover(song: Song) {
  if (!song.cover) return null;
  const path = isUploadSong(song.id) ? song.cover : `/api/songs/${song.id}/cover`;
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get('Content-Type') || '';
    if (!response.ok || !ART_EXTENSION[type]) { await response.body?.cancel(); return null; }
    const blob = await response.blob();
    return blob.size > 0 && blob.size <= MAX_ART_BYTES ? blob : null;
  } catch { return null; }
}

async function fetchLyrics(id: string) {
  try {
    const response = await fetch(`/api/songs/${id}/lyrics`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { lines: LyricLine[]; plainText?: string };
    const synced = formatLrc(payload.lines);
    const text = synced || payload.plainText?.trim();
    if (!text) return null;
    const data = new Blob([text], { type: 'text/plain;charset=utf-8' });
    return data.size <= MAX_LYRIC_BYTES ? { data, ext: synced ? 'lrc' : 'txt' } : null;
  } catch { return null; }
}

export function useDeviceMusic() {
  const folder = useRef<MusicFolder | undefined>(undefined);
  const tracks = useRef(new Map<string, DeviceTrack>());
  const scan = useRef(0);
  const [status, setStatus] = useState<Status>('loading');
  const [songs, setSongs] = useState<Song[]>([]);

  const refresh = useCallback(async () => {
    const current = folder.current;
    if (!current) return;
    const revision = ++scan.current;
    try {
      if (await current.queryPermission(PERMISSION) !== 'granted') {
        if (revision === scan.current) {
          tracks.current = new Map();
          setSongs([]);
          setStatus('authorize');
        }
        return;
      }
      const found = await listTracks(current, tracks.current, () => revision === scan.current);
      if (revision !== scan.current) return;
      tracks.current = found;
      const order = new Intl.Collator(undefined, { numeric: true });
      setSongs([...found.values()].map(item => item.song).sort((a, b) => order.compare(a.name, b.name) || order.compare(a.id, b.id)));
      setStatus('ready');
    } catch {
      if (revision === scan.current) {
        tracks.current = new Map();
        setSongs([]);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    if (!window.isSecureContext) { setStatus('insecure'); return; }
    if (!(window as MusicWindow).showDirectoryPicker) { setStatus('unsupported'); return; }
    let live = true;
    folderRecord().then(saved => {
      if (!live) return;
      folder.current = saved;
      if (saved) return refresh();
      setStatus('authorize');
    }).catch(() => { if (live) setStatus('error'); });
    return () => { live = false; scan.current++; };
  }, [refresh]);

  const authorize = useCallback(async () => {
    const picker = (window as MusicWindow).showDirectoryPicker;
    if (!window.isSecureContext || !picker) throw Error('此设备需要支持音乐文件夹授权的浏览器和安全连接');
    const current = folder.current;
    if (current) {
      if (await current.requestPermission(PERMISSION) !== 'granted') throw Error('请允许访问设备的音乐文件夹');
      return current;
    }
    const picked = await picker.call(window, { ...PERMISSION, startIn: 'music' });
    const saved = await folderRecord(picked);
    folder.current = saved;
    if (!saved || (saved !== picked && await saved.queryPermission(PERMISSION) !== 'granted')) {
      throw Error('请重新授权已连接的音乐文件夹');
    }
    return saved;
  }, []);

  const connect = useCallback(async () => { await authorize(); await refresh(); }, [authorize, refresh]);
  const getFile = useCallback(async (id: string) => {
    const track = tracks.current.get(id);
    if (!track) throw Error('找不到文件，请重新读取音乐文件夹');
    return track.file.getFile();
  }, []);

  const getLyrics = useCallback(async (id: string) => {
    const handle = tracks.current.get(id)?.lyric;
    if (!handle) return { lines: [] };
    const file = await handle.getFile();
    if (file.size > MAX_LYRIC_BYTES) return { lines: [] };
    const text = await file.text();
    const lines = parseLrc(text);
    return { lines, plainText: lines.length ? '' : text.trim() };
  }, []);

  const download = useCallback(async (song: Song, level: string, includeLyrics: boolean) => {
    const target = await authorize();
    const [cover, lyric] = await Promise.all([fetchCover(song), includeLyrics ? fetchLyrics(song.id) : null]);
    const response = await fetch(`/api/songs/${song.id}/download?level=${encodeURIComponent(level)}`, { method: 'POST' });
    if (!response.ok || !response.body) {
      const details = await response.json().catch(() => null);
      throw Error(details?.error || '下载失败，请稍后重试');
    }
    const stream = response.body;
    const extension = response.headers.get('X-Audio-Format');
    try {
      if (!extension || !AUDIO_EXT.test(`.${extension}`) || !response.headers.get('Content-Type')?.startsWith('audio/')) {
        throw Error('服务器返回了无效的音频文件');
      }
      const result = await navigator.locks.request('nestune-music-download', async () => {
        const stem = await unusedStem(target, fileBase(song));
        const file = await target.getFileHandle(`${stem}.${extension}`, { create: true });
        await stream.pipeTo(await file.createWritable());
        const tagged = await file.getFile().then(original => embedDeviceTags(original, song, cover)).catch(() => null);
        let coverSaved = false;
        if (tagged) coverSaved = await writeFile(file, tagged).then(() => !!cover).catch(() => false);
        if (cover && !coverSaved) {
          coverSaved = await target.getFileHandle(`${stem}.${ART_EXTENSION[cover.type]}`, { create: true })
            .then(handle => writeFile(handle, cover)).then(() => true).catch(() => false);
        }
        const lyricsSaved = lyric && await target.getFileHandle(`${stem}.${lyric.ext}`, { create: true })
          .then(handle => writeFile(handle, lyric.data)).then(() => true).catch(() => false);
        return { coverSaved, lyricsSaved: !!lyricsSaved };
      });
      await refresh();
      return result;
    } catch (error) {
      if (!stream.locked) await stream.cancel().catch(() => {});
      throw error;
    }
  }, [authorize, refresh]);

  return useMemo(() => ({ status, songs, connect, refresh, getFile, getLyrics, download }), [status, songs, connect, refresh, getFile, getLyrics, download]);
}
