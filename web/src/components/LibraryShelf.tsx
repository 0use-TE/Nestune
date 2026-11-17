'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { Cover } from './Cover';
import { FavoriteCollections } from './CollectionFavorite';
import { Hero } from './Hero';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Empty, Loading, SongList } from './SongList';

type CollectionKind = 'album' | 'playlist' | 'shared' | 'mine';
type Metadata = { name: string; cover: string | null; trackCount?: number };
type CollectionPage = { album?: Metadata; playlist?: Metadata; songs: Song[] };

const routes: Record<CollectionKind, string> = { album: 'albums', playlist: 'playlists', shared: 'shared-playlists', mine: 'me/playlists' };
const collectionLink = (key: string) => `/library?collection=${encodeURIComponent(key)}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function LibraryShelf({ selection, favorites }: { selection: string; favorites: Song[] | null }) {
  const app = useApp();
  const [, kind, id] = /^(album|playlist|shared|mine):([a-zA-Z0-9-]{1,80})$/.exec(selection) ?? [];
  const showingLikes = selection === 'likes';

  if (showingLikes || kind) return <div className="library-detail">
    <Link className="btn ghost sm library-back" href="/library">返回音乐库</Link>
    {showingLikes ? <LikedSongs songs={favorites} /> : <SavedCollection kind={kind as CollectionKind} id={id} />}
  </div>;

  return <div className="grid collection-grid library-shelf">
    <Link className="card library-likes" href={collectionLink('likes')} scroll={false}>
      <span className="library-likes-cover"><Icon n="heart" s={44} /></span>
      <b>我的喜欢</b>
      {favorites && <span className="sub sm">{favorites.length} 首</span>}
    </Link>
    <FavoriteCollections hrefFor={item => collectionLink(`${item.kind}:${item.id}`)} />
    {app.playlists.map(item => <Link key={item.id} className="card" href={collectionLink(`mine:${item.id}`)} scroll={false}>
      <Cover src={item.cover} seed={`pl${item.id}`} />
      <b className="t1">{item.name}</b><span className="sub sm t1">我的歌单 · {item.trackCount} 首</span>
    </Link>)}
  </div>;
}

function LikedSongs({ songs }: { songs: Song[] | null }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function addToPlaylist(id: number) {
    if (target !== null) return;
    setTarget(id);
    setError('');
    try {
      const result = await post<{ added: number; skipped: number }>(`/api/me/playlists/${id}/songs`, { from: 'favorites' });
      await app.reloadPlaylists();
      setOpen(false);
      app.toast(`已添加 ${result.added} 首${result.skipped ? `，跳过 ${result.skipped} 首已有歌曲` : ''}`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setTarget(null); }
  }

  if (!songs) return <Loading />;
  return <>
    <Hero seed="favorites" cover={songs[0]?.cover} title="我的喜欢" sub={`${songs.length} 首`}>
      <button className="btn light" disabled={!songs.length} onClick={() => app.play(songs)}><Icon n="play" s={16} />播放全部</button>
      <button className="btn ghost" disabled={!songs.length} onClick={() => { setError(''); setOpen(true); }}><Icon n="plus" s={16} />全部添加到歌单…</button>
    </Hero>
    <div className="library-detail-songs">{songs.length ? <SongList songs={songs} /> : <Empty text="点歌曲旁的爱心，把它添加到我的喜欢。" />}</div>
    {open && <Sheet title="添加到歌单" onClose={() => { if (target === null) setOpen(false); }}>
      {error && <p className="err" role="alert">{error}</p>}
      {app.playlists.length ? <div className="library-targets">
        {app.playlists.map(playlist => <button key={playlist.id} type="button" className="library-target" disabled={target !== null} onClick={() => void addToPlaylist(playlist.id)}>
          <Cover src={playlist.cover} seed={playlist.id} />
          <span className="t1">{playlist.name}</span>
          {target === playlist.id ? <Loading inline label="正在添加" /> : <span className="sub sm">{playlist.trackCount} 首</span>}
        </button>)}
      </div> : <button type="button" className="btn ghost" onClick={() => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('nt:new-playlist'));
      }}><Icon n="plus" s={16} />新建歌单</button>}
    </Sheet>}
  </>;
}

function SavedCollection({ kind, id }: { kind: CollectionKind; id: string }) {
  const app = useApp();
  const [detail, setDetail] = useState<{ meta: Metadata; songs: Song[] } | null>(null);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const url = `/api/${routes[kind]}/${encodeURIComponent(id)}`;

  useEffect(() => {
    let active = true;
    get<CollectionPage>(kind === 'playlist' ? `${url}?limit=100` : url).then(result => {
      if (!active) return;
      const meta = result.album ?? result.playlist;
      if (meta) setDetail({ meta, songs: result.songs });
      else setError('无法读取收藏详情');
    }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [kind, url]);

  if (!detail) return error ? <p className="note" role="alert">{error}</p> : <Loading />;
  const { meta, songs } = detail;
  const total = meta.trackCount ?? songs.length;

  async function more(playAll: boolean) {
    if (fetching) return;
    if (kind !== 'playlist' || songs.length >= total) {
      if (playAll) app.play(songs);
      return;
    }
    setFetching(true);
    setError('');
    const loaded = [...songs];
    try {
      do {
        const next = await get<CollectionPage>(`${url}?limit=100&offset=${loaded.length}`);
        if (!next.songs.length) break;
        loaded.push(...next.songs);
      } while (playAll && loaded.length < total);
      setDetail({ meta, songs: loaded });
      if (playAll) app.play(loaded);
    } catch (error) { setError(errorMessage(error)); }
    finally { setFetching(false); }
  }

  return <>
    <Hero cover={meta.cover ?? songs[0]?.cover} seed={id} title={meta.name} sub={`${total} 首`}>
      <button className="btn light" disabled={fetching || !songs.length} onClick={() => void more(true)}><Icon n="play" s={16} />播放全部</button>
      {kind === 'mine' && <Link className="btn ghost" href={`/my/${id}`}>管理歌单</Link>}
    </Hero>
    <div className="library-detail-songs">{songs.length ? <SongList songs={songs} /> : <Empty text="暂无歌曲。" />}</div>
    {error && <p className="err" role="alert">{error}</p>}
    {kind === 'playlist' && songs.length < total && <div className="center"><button className="btn ghost" disabled={fetching} onClick={() => void more(false)}>{fetching ? '加载中…' : '加载更多'}</button></div>}
  </>;
}
