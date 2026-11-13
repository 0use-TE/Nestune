'use client';
import { Loading } from './Loading';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isDeviceSong } from '@/lib/device-music';
import type { Song } from '@/lib/types';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export function ChatSongPicker({ current, busy, onShare, onClose }: {
  current: Song | null; busy: boolean; onShare: (id: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ keyword: string; songs: Song[]; error?: string }>();
  const keyword = query.trim();

  useEffect(() => {
    if (!keyword) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { items } = await api<{ items: Song[] }>(`/api/search?type=song&limit=12&keywords=${encodeURIComponent(keyword)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ keyword, songs: items });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ keyword, songs: [], error: error instanceof Error ? error.message : '搜索失败' });
      }
    }, 280);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [keyword]);

  const matches = result?.keyword === keyword ? result : undefined;
  const shareable = current && !isDeviceSong(current.id) ? current : null;
  const songs = keyword ? matches?.songs ?? [] : shareable ? [shareable] : [];

  return (
    <Sheet className="chat-song-sheet" title="分享歌曲" onClose={onClose}>
      <label className="chat-song-search">
        <Icon n="search" s={16} />
        <input type="search" autoFocus aria-label="搜索歌曲" placeholder="搜索歌曲或歌手" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <div className="chat-song-results">
        {!keyword && shareable && <p className="sub sm">当前歌曲</p>}
        {keyword && !songs.length && <p role="status" className="sub">{matches?.error || (matches ? '没有找到歌曲' : <Loading inline label="正在搜索歌曲" />)}</p>}
        {songs.map(song => (
          <button type="button" className="chat-song-row" key={song.id} aria-label={`分享 ${song.name}`} disabled={busy} onClick={() => onShare(song.id)}>
            <Cover src={song.cover} seed={song.id} />
            <span className="chat-song-text"><b className="t1">{song.name}</b><small className="t1">{song.artists.map(artist => artist.name).join(' / ')}</small></span>
            <Icon n="send" s={16} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
