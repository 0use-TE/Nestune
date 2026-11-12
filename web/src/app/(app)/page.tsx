'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { fmtCount } from '@/lib/util';
import { Cover } from '@/components/Cover';
import { Hero } from '@/components/Hero';
import { HomeSearch } from '@/components/HomeSearch';
import { Icon } from '@/components/Icon';
import { SongList } from '@/components/SongList';
import { StartupLoading } from '@/components/StartupLoading';

type Home = { playlists: { id: string; name: string; cover: string | null; playCount?: number }[]; newSongs: Song[]; charts: { id: string; name: string; cover: string | null; updateFrequency?: string }[] };

export default function HomePage() {
  const app = useApp();
  const [home, setHome] = useState<Home | null>(null);
  const [recent, setRecent] = useState<Song[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    get('/api/home').then(setHome).catch(e => setErr(e.message));
    get('/api/me/history?limit=8').then(r => setRecent(r.songs)).catch(() => {});
  }, []);

  const feature = app.current ?? recent[0] ?? home?.newSongs[0] ?? null;

  return (
    <>
      <div className="home-heading">
        <h1>今天想听点什么</h1>
        <HomeSearch />
      </div>

      {feature && (
        <Hero cover={feature.cover} seed={feature.id} tag={app.current ? (app.playing ? '正在播放' : '继续播放') : recent[0] ? '继续听' : '为你推荐'}
          title={feature.name} sub={`${feature.artists.map(a => a.name).join(' / ')}${feature.album.name ? ` · ${feature.album.name}` : ''}`}>
          {app.current?.id === feature.id
            ? <button className="btn light" onClick={app.toggle}><Icon n={app.playing ? 'pause' : 'play'} s={16} />{app.playing ? '暂停' : '播放'}</button>
            : <button className="btn light" onClick={() => app.play([feature])}><Icon n="play" s={16} />播放</button>}
          {app.current && <button className="btn ghost" onClick={() => app.setNowOpen(true)}>歌曲详情</button>}
        </Hero>
      )}
      {err && <div className="note" style={{ marginTop: 20 }}>{err}</div>}

      {recent.length > 0 && <><div className="sec"><h2>最近播放</h2><Link href="/library?tab=history" className="link">查看全部</Link></div><SongList songs={recent.slice(0, 5)} num={false} /></>}

      {home && home.playlists.length > 0 && (
        <>
          <div className="sec"><h2>推荐歌单</h2></div>
          <div className="grid">
            {home.playlists.slice(0, 12).map(p => (
              <Link key={p.id} href={`/playlist/${p.id}`} className="card">
                <Cover src={p.cover} seed={p.id} /><b className="t1">{p.name}</b><span className="sub sm">{fmtCount(p.playCount) && `${fmtCount(p.playCount)} 次播放`}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {home && home.newSongs.length > 0 && (<><div className="sec"><h2>新歌速递</h2></div><SongList songs={home.newSongs.slice(0, 8)} num={false} /></>)}

      {home && home.charts.length > 0 && (
        <>
          <div className="sec"><h2>排行榜</h2></div>
          <div className="grid">
            {home.charts.map(p => (
              <Link key={p.id} href={`/playlist/${p.id}`} className="card">
                <Cover src={p.cover} seed={p.id} /><b className="t1">{p.name}</b><span className="sub sm">{p.updateFrequency}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {!home && !err && <StartupLoading />}
    </>
  );
}
