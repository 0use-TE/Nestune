'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { SharePlaylist } from '@/components/SharePlaylist';
import { useApp } from '@/lib/app';
import type { PlaylistLite, Song } from '@/lib/types';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { Loading, SongList } from '@/components/SongList';

type Shared = { playlist: PlaylistLite; songs: Song[]; owner: { id: number; name: string } };
export default function SharedPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  useEffect(() => { let live = true; setData(null); setError(''); get<Shared>(`/api/shared-playlists/${id}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [id]);
  if (error) return <div className="center sub">{error}</div>;
  if (!data) return <Loading />;
  return <>
    <Hero cover={data.playlist.cover} seed={`pl${id}`} tag="公开歌单" title={data.playlist.name} sub={`${data.songs.length} 首歌曲`}>
      <button className="btn light" disabled={!data.songs.length} onClick={() => app.play(data.songs)}><Icon n="play" s={16} />播放全部</button>
      <Link className="btn ghost" href={`/people/${data.owner.id}`}>{data.owner.name}</Link>
      <button className="btn ghost" onClick={() => setSharing(true)}>分享</button>
    </Hero>
    {sharing && <SharePlaylist playlist={data.playlist} onClose={() => setSharing(false)} />}
    {data.playlist.description && <p className="sub section-heading">{data.playlist.description}</p>}
    <div className="section-heading"><SongList songs={data.songs} /></div>
  </>;
}
