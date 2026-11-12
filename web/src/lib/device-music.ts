'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from './types';

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|wav|ogg|oga|opus|webm)$/i;
const PERMISSION = { mode: 'readwrite' } as const;
type MusicFolder = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(options: typeof PERMISSION): Promise<PermissionState>;
  requestPermission(options: typeof PERMISSION): Promise<PermissionState>;
};
type MusicWindow = Window & { showDirectoryPicker?: (options: typeof PERMISSION & { startIn: 'music' }) => Promise<MusicFolder> };
type DeviceTrack = { song: Song; file: FileSystemFileHandle };
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

async function listTracks(root: MusicFolder) {
  const tracks = new Map<string, DeviceTrack>();
  const folders = [{ folder: root, prefix: '' }];
  while (folders.length) {
    const { folder, prefix } = folders.pop()!;
    for await (const entry of folder.values()) {
      if (entry.kind === 'directory') {
        folders.push({ folder: entry as MusicFolder, prefix: `${prefix}${entry.name}/` });
      } else if (AUDIO_EXT.test(entry.name)) {
        const id = `device:${prefix}${entry.name}`;
        tracks.set(id, {
          file: entry as FileSystemFileHandle,
          song: { id, name: entry.name.replace(AUDIO_EXT, ''), artists: [], album: { id: null, name: '' }, duration: 0, cover: null },
        });
      }
    }
  }
  return tracks;
}

function fileBase(song: Song) {
  const title = [song.name, song.artists.map(artist => artist.name).join('、')].filter(Boolean).join(' - ');
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/, '') || 'Nestune';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
}

async function unusedFile(folder: MusicFolder, base: string, ext: string) {
  for (let index = 1; ; index++) {
    const name = `${base}${index === 1 ? '' : ` (${index})`}.${ext}`;
    try { await folder.getFileHandle(name); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return folder.getFileHandle(name, { create: true });
      if (!(error instanceof DOMException && error.name === 'TypeMismatchError')) throw error;
    }
  }
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
      const found = await listTracks(current);
      if (revision !== scan.current) return;
      tracks.current = found;
      setSongs([...found.values()].map(item => item.song).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
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

  const download = useCallback(async (song: Song, level: string) => {
    const target = await authorize();
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
      await navigator.locks.request('nestune-music-download', async () => {
        const file = await unusedFile(target, fileBase(song), extension);
        await stream.pipeTo(await file.createWritable());
      });
    } catch (error) {
      if (!stream.locked) await stream.cancel().catch(() => {});
      throw error;
    }
    await refresh();
  }, [authorize, refresh]);

  return useMemo(() => ({ status, songs, connect, refresh, getFile, download }), [status, songs, connect, refresh, getFile, download]);
}
