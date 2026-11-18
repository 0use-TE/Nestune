'use client';
import Link from 'next/link';
import { PlaylistImport } from '@/components/PlaylistImport';
import { useApp } from '@/lib/app';
import { Cover, Avatar } from '@/components/Cover';
import { PlaylistLink } from '@/components/PlaylistLink';
import { Icon } from '@/components/Icon';
import { useEffect, useRef, useState } from 'react';
import { CanvasSource } from '@/components/CanvasSource';
import { personalPlaylistSongs } from '@/lib/playlist-queue';
import { Loading } from '@/components/Loading';

export default function MyMusicPage() {
  const app = useApp();
  const [adding, setAdding] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function add(id: string) {
    if (adding) return;
    setAdding(id);
    try { const songs = await personalPlaylistSongs(id); if (!mounted.current) return; await app.appendMany(songs); window.dispatchEvent(new Event('nt:canvas-open-queue')); }
    catch (error) { app.toast(error instanceof Error ? error.message : '添加歌单失败'); }
    finally { if (mounted.current) setAdding(null); }
  }
  return <>
    <div className="my-heading"><div className="row"><Avatar src={app.me!.avatar} name={app.me!.displayName} /><h1>{app.me!.displayName}</h1></div><Link href="/settings" className="btn ghost sm">设置</Link></div>
    <div className="my-heading"><h2>我的歌单</h2><div className="row"><PlaylistImport /><button className="btn ghost sm" onClick={() => window.dispatchEvent(new CustomEvent('nt:new-playlist'))}><Icon n="plus" s={16} />新建歌单</button></div></div>
    <div className="personal-playlists">
      <PlaylistLink href="/library?collection=likes"><span className="favorites-cover"><Icon n="heart" s={24} /></span><div><b>我喜欢的音乐</b></div></PlaylistLink>
      {app.playlists.map(p => <CanvasSource key={p.id} queue source={{ kind: 'playlist', playlistId: String(p.id), name: p.name, cover: p.cover }}>
        <div className="personal-playlist-entry"><PlaylistLink href={`/my/${p.id}`}><Cover src={p.cover} seed={`pl${p.id}`} /><div className="t1"><b>{p.name}</b><div className="sub sm">{p.trackCount} 首 · {p.isPublic ? '公开' : '私密'}</div></div></PlaylistLink>
          <button type="button" className="ib playlist-queue-add" data-no-music-drag aria-label={`将歌单「${p.name}」加入播放列表`} title="加入播放列表" disabled={!!adding || !p.trackCount} onClick={() => void add(String(p.id))}>{adding === String(p.id) ? <Loading inline label="正在添加" /> : <Icon n="plus" s={18} />}</button>
        </div>
      </CanvasSource>)}
    </div>
  </>;
}
