'use client';
import { Loading } from './Loading';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isDeviceSong } from '@/lib/device-music';
import type { Song } from '@/lib/types';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { useApp } from '@/lib/app';
import { personalPlaylistPath } from '@/lib/playlist-queue';
import { CanvasSource } from './CanvasSource';

export function ChatSongPicker({ current, busy, onShare, onClose, purpose = 'friend' }: {
  current: Song | null; busy: boolean; onShare: (id: string) => void; onClose: () => void; purpose?: 'friend' | 'domain-share' | 'domain-add';
}) {
  const app = useApp();
  const [tab, setTab] = useState<'current' | 'playlists' | 'search'>(current ? 'current' : 'playlists');
  const [playlist, setPlaylist] = useState('favorites');
  const [playlistResult, setPlaylistResult] = useState<{ id: string; songs: Song[]; error?: string }>();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ keyword: string; songs: Song[]; error?: string }>();
  const keyword = query.trim();

  useEffect(() => {
    if (!keyword || tab !== 'search') return;
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
  }, [keyword, tab]);

  useEffect(() => {
    if (tab !== 'playlists') return;
    const controller = new AbortController();
    api<{ songs: Song[] }>(personalPlaylistPath(playlist), { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setPlaylistResult({ id: playlist, songs: data.songs.filter(song => !isDeviceSong(song.id)) });
    }).catch(error => {
      if (!controller.signal.aborted) setPlaylistResult({ id: playlist, songs: [], error: error instanceof Error ? error.message : '读取歌单失败' });
    });
    return () => controller.abort();
  }, [tab, playlist]);

  const matches = result?.keyword === keyword ? result : undefined;
  const shareable = current && !isDeviceSong(current.id) ? current : null;
  const loadedPlaylist = playlistResult?.id === playlist ? playlistResult : undefined;
  const songs = tab === 'playlists' ? loadedPlaylist?.songs ?? [] : tab === 'search' ? matches?.songs.filter(song => !isDeviceSong(song.id)) ?? [] : shareable ? [shareable] : [];
  const adding = purpose === 'domain-add';
  const verb = adding ? '添加' : '分享';

  return (
    <Sheet className="chat-song-sheet" title={adding ? '添加到域歌单' : '分享歌曲'} onClose={onClose}>
      <nav className="chips chat-song-tabs" aria-label="分享歌曲来源">{([['current', '当前歌曲'], ['playlists', '我的歌单'], ['search', '搜索']] as const).map(([value, label]) => <button type="button" key={value} className={`chip ${tab === value ? 'on' : ''}`} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
      {tab === 'search' && <label className="chat-song-search">
        <Icon n="search" s={16} />
        <input type="search" aria-label="搜索要分享的歌曲" placeholder="搜索歌曲或歌手" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
      </label>}
      {tab === 'playlists' && <label className="chat-playlist-select sub sm">选择歌单<select aria-label="选择要分享歌曲的歌单" value={playlist} onChange={event => setPlaylist(event.target.value)}><option value="favorites">我喜欢的音乐</option>{app.playlists.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select></label>}
      {purpose === 'friend' && <p className="chat-drag-instruction sub sm">点右侧发送，或长按后拖到好友头像、聊天区域</p>}
      <div className="chat-song-results">
        {tab === 'current' && !shareable && <p className="sub">暂无可选的当前歌曲，可以从我的歌单里选择</p>}
        {tab === 'search' && !keyword && <p className="sub">输入歌名或歌手</p>}
        {tab === 'search' && keyword && !songs.length && <p role="status" className="sub">{matches?.error || (matches ? '没有找到歌曲' : <Loading inline label="正在搜索歌曲" />)}</p>}
        {tab === 'playlists' && !songs.length && <p role="status" className="sub">{loadedPlaylist?.error || (loadedPlaylist ? '这个歌单还没有可分享的歌曲' : <Loading inline label="正在读取歌单" />)}</p>}
        {songs.map(song => {
          const button = <button type="button" className="chat-song-row" key={song.id} aria-label={`${verb} ${song.name}`} disabled={busy} onClick={() => onShare(song.id)}>
            <Cover src={song.cover} seed={song.id} />
            <span className="chat-song-text"><b className="t1">{song.name}</b><small className="t1">{song.artists.map(artist => artist.name).join(' / ')}</small></span>
            <Icon n={adding ? 'plus' : 'send'} s={16} />
          </button>;
          return purpose === 'friend' ? <CanvasSource key={song.id} source={{ kind: 'song', songId: song.id, name: song.name, cover: song.cover, previewSong: song }}>{button}</CanvasSource> : button;
        })}
      </div>
    </Sheet>
  );
}
