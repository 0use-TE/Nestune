'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { fmtCount } from '@/lib/util';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { Loading, SongList } from '@/components/SongList';

type Meta = { id: string; name: string; cover: string | null; description: string; creator: string; trackCount: number; playCount: number };

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    setMeta(null); setSongs([]); setErr('');
    get(`/api/playlists/${id}?limit=100`).then(r => { setMeta(r.playlist); setSongs(r.songs); }).catch(e => setErr(e.message));
  }, [id]);

  async function loadMore() {
    setMore(true);
    try { const r = await get(`/api/playlists/${id}?limit=100&offset=${songs.length}`); setSongs(p => [...p, ...r.songs]); } catch (e: any) { app.toast(e.message); }
    setMore(false);
  }

  if (err) return <div className="note">{err}</div>;
  if (!meta) return <Loading />;
  return (
    <>
      <Hero cover={meta.cover} seed={meta.id} tag="歌单" title={meta.name}
        sub={<>{meta.creator && `${meta.creator} · `}{meta.trackCount} 首{meta.playCount ? ` · ${fmtCount(meta.playCount)} 次播放` : ''}</>}>
        <button className="btn light" onClick={() => app.play(songs)} disabled={!songs.length}><Icon n="play" s={16} />播放全部</button>
        <button className="btn ghost" onClick={() => app.play(songs, 0, 'shuffle')} disabled={!songs.length}><Icon n="shuffle" s={16} />随机播放</button>
      </Hero>
      {meta.description && <p className="sub" style={{ margin: '22px 0 0', maxWidth: 680, whiteSpace: 'pre-line' }}>{meta.description.slice(0, 300)}</p>}
      <div style={{ marginTop: 26 }}><SongList songs={songs} /></div>
      {songs.length < meta.trackCount && <div className="center" style={{ padding: '30px 0' }}><button className="btn ghost" disabled={more} onClick={loadMore}>{more ? '加载中…' : '加载更多'}</button></div>}
    </>
  );
}
