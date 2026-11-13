'use client';
import Link from 'next/link';
import { useApp } from '@/lib/app';
import { Cover, Avatar } from '@/components/Cover';
import { Icon } from '@/components/Icon';

export default function MyMusicPage() {
  const app = useApp();
  return <>
    <div className="my-heading"><div className="row"><Avatar src={app.me!.avatar} name={app.me!.displayName} /><h1>{app.me!.displayName}</h1></div><Link href="/settings" className="btn ghost sm">设置</Link></div>
    <div className="my-heading"><h2>我的歌单</h2><button className="btn ghost sm" onClick={() => window.dispatchEvent(new CustomEvent('nt:new-playlist'))}><Icon n="plus" s={16} />新建歌单</button></div>
    <div className="personal-playlists">
      <Link className="panel playlist-card" href="/library"><span className="favorites-cover"><Icon n="heart" s={24} /></span><div><b>我喜欢的音乐</b><div className="sub sm">{app.favIds.size} 首</div></div></Link>
      {app.playlists.map(p => <Link key={p.id} href={`/my/${p.id}`} className="panel playlist-card"><Cover src={p.cover} seed={`pl${p.id}`} /><div className="t1"><b>{p.name}</b><div className="sub sm">{p.trackCount} 首 · {p.isPublic ? '公开' : '私密'}</div></div></Link>)}
    </div>
  </>;
}
