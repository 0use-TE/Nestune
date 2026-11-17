'use client';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, get } from '@/lib/api';
import { loadArtistQueue, type ArtistSongsPage } from '@/lib/artist-queue';
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
  const [loadingAll, setLoadingAll] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    setArtist(null); setSongs([]); setErr(''); setLoadingAll(false);
    get(`/api/artists/${id}`).then(r => { if (alive) { setArtist(r.artist); setSongs(r.songs); } }).catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; pending.current?.abort(); pending.current = null; };
  }, [id]);

  async function playAll() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setLoadingAll(true); setLoaded(0);
    try {
      const result = await loadArtistQueue((offset, limit) => api<ArtistSongsPage>(`/api/artists/${id}/songs?limit=${limit}&offset=${offset}`, { signal: controller.signal }), controller.signal, setLoaded);
      if (!result.songs.length) { app.toast('当前音源账号暂无这位歌手可播放的歌曲'); return; }
      app.play(result.songs);
      if (result.limited) app.toast(`已播放曲库前 500 首中的 ${result.songs.length} 首可播放歌曲`);
    } catch (error) { if (!controller.signal.aborted) app.toast(error instanceof Error ? error.message : '无法加载歌手歌曲'); }
    finally { if (pending.current === controller) { pending.current = null; setLoadingAll(false); } }
  }

  if (err) return <div className="note">{err}</div>;
  if (!artist) return <Loading />;
  return (
    <>
      <Hero round cover={artist.cover} seed={artist.id} tag="歌手" title={artist.name} sub={`${artist.musicSize ?? 0} 首歌曲 · ${artist.albumSize ?? 0} 张专辑`}>
        <button className="btn light" onClick={() => void playAll()} disabled={loadingAll || !songs.length} aria-busy={loadingAll}><Icon n="play" s={16} />{loadingAll ? `正在加载${loaded ? ` ${loaded} 首` : '歌曲'}` : '播放全部'}</button>
        {loadingAll ? <button className="btn ghost" onClick={() => pending.current?.abort()}>取消加载</button>
          : <button className="btn ghost" onClick={() => app.play(songs)} disabled={!songs.length}>播放热门歌曲</button>}
      </Hero>
      {artist.description && <p className="sub" style={{ margin: '22px 0 0', maxWidth: 680, whiteSpace: 'pre-line' }}>{String(artist.description).slice(0, 300)}</p>}
      <div className="sec"><h2>热门歌曲</h2></div>
      <SongList songs={songs} />
    </>
  );
}
