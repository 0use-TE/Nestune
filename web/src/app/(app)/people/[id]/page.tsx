'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { PlaylistLite } from '@/lib/types';
import { Avatar, Cover } from '@/components/Cover';
import { Loading } from '@/components/Loading';

type Profile = { person: { id: number; name: string; username: string; avatar: string | null; bio: string }; playlists: PlaylistLite[] };
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); setError(''); get<Profile>(`/api/people/${id}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [id]);
  if (error) return <div className="center sub">{error}</div>;
  if (!data) return <Loading />;
  return <>
    <section className="panel pad public-profile"><Avatar src={data.person.avatar} name={data.person.name} large /><div><h1>{data.person.name}</h1><span className="sub">@{data.person.username}</span>{data.person.bio && <p>{data.person.bio}</p>}</div></section>
    <h2 className="section-heading">公开歌单</h2>
    <div className="personal-playlists">{data.playlists.map(p => <Link key={p.id} href={`/shared/${p.id}`} className="panel playlist-card"><Cover src={p.cover} seed={`pl${p.id}`} /><div className="t1"><b>{p.name}</b><div className="sub sm">{p.trackCount} 首</div></div></Link>)}</div>
    {!data.playlists.length && <div className="center sub">暂无公开歌单</div>}
  </>;
}
