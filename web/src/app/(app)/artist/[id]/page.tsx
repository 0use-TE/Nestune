'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { Loading, SongList } from '@/components/SongList';

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    setArtist(null); setErr('');
    get(`/api/artists/${id}`).then(r => { setArtist(r.artist); setSongs(r.songs); }).catch(e => setErr(e.message));
  }, [id]);

  if (err) return <div className="note">{err}</div>;
  if (!artist) return <Loading />;
  return (
    <>
      <Hero round cover={artist.cover} seed={artist.id} tag="歌手" title={artist.name} sub={`${artist.musicSize ?? 0} 首歌曲 · ${artist.albumSize ?? 0} 张专辑`}>
        <button className="btn light" onClick={() => app.play(songs)} disabled={!songs.length}><Icon n="play" s={16} />播放热门歌曲</button>
      </Hero>
      {artist.description && <p className="sub" style={{ margin: '22px 0 0', maxWidth: 680, whiteSpace: 'pre-line' }}>{String(artist.description).slice(0, 300)}</p>}
      <div className="sec"><h2>热门歌曲</h2></div>
      <SongList songs={songs} />
    </>
  );
}
