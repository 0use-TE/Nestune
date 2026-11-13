'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { fmtDate } from '@/lib/util';
import { CollectionFavoriteButton } from '@/components/CollectionFavorite';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { Loading, SongList } from '@/components/SongList';

export default function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const [album, setAlbum] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    setAlbum(null); setErr('');
    get(`/api/albums/${id}`).then(r => { setAlbum(r.album); setSongs(r.songs); }).catch(e => setErr(e.message));
  }, [id]);

  if (err) return <div className="note">{err}</div>;
  if (!album) return <Loading />;
  return (
    <>
      <Hero cover={album.cover} seed={album.id} tag="专辑" title={album.name} sub={`${album.artist}${album.publishTime ? ` · ${fmtDate(album.publishTime)}` : ''} · ${songs.length} 首`}>
        <button className="btn light" onClick={() => app.play(songs)} disabled={!songs.length}><Icon n="play" s={16} />播放全部</button>
        <CollectionFavoriteButton kind="album" id={album.id} />
      </Hero>
      {album.description && <p className="sub" style={{ margin: '22px 0 0', maxWidth: 680, whiteSpace: 'pre-line' }}>{String(album.description).slice(0, 300)}</p>}
      <div style={{ marginTop: 26 }}><SongList songs={songs} /></div>
    </>
  );
}
