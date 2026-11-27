'use client';

import Link from 'next/link';
import { PlaylistImport } from './PlaylistImport';
import { PlaylistFolders, SaveFolderToPlaylist } from './PlaylistFolders';
import type { PlaylistFolder } from '@/lib/playlist-folders';
import { useEffect, useRef, useState } from 'react';
import { del, get, put } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { CollectionFavorite } from '@/lib/collection-types';
import type { Song } from '@/lib/types';
import { Cover } from './Cover';
import { Hero } from './Hero';
import { SortableLibraryGrid } from './SortableLibraryGrid';
import { Icon } from './Icon';
import { Empty, Loading, SongList } from './SongList';

type CollectionKind = 'album' | 'playlist' | 'shared' | 'mine';
type Metadata = { name: string; cover: string | null; trackCount?: number };
type CollectionPage = { album?: Metadata; playlist?: Metadata; songs: Song[]; folders?: PlaylistFolder[]; directSongs?: Song[] };
type ShelfData = { items: CollectionFavorite[]; order: string[] };
type Card = { key: string; name: string; cover: string | null; sub: string; bookmark?: CollectionFavorite };

const routes: Record<CollectionKind, string> = { album: 'albums', playlist: 'playlists', shared: 'shared-playlists', mine: 'me/playlists' };
const collectionLink = (key: string) => `/library?collection=${encodeURIComponent(key)}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function LibraryShelf({ selection, favorites }: { selection: string; favorites: Song[] | null }) {
  const app = useApp();
  const [shelf, setShelf] = useState<ShelfData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState('');
  const [saving, setSaving] = useState(false);
  const savingOrder = useRef(false);
  const [, kind, id] = /^(album|playlist|shared|mine):([a-zA-Z0-9-]{1,80})$/.exec(selection) ?? [];
  const showingLikes = selection === 'likes';

  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      setLoadError('');
      get<ShelfData>('/api/me/collections').then(data => {
        if (!active || request !== generation) return;
        setShelf(previous => savingOrder.current && previous ? { ...data, order: previous.order } : data);
      }).catch(error => { if (active && request === generation) setLoadError(errorMessage(error)); });
    };
    load();
    window.addEventListener('nt:collection-change', load);
    return () => { active = false; window.removeEventListener('nt:collection-change', load); };
  }, [retry, app.me?.id]);

  if (showingLikes || kind) return <div className="library-detail">
    <Link className="btn ghost sm library-back" href="/library">返回音乐库</Link>
    {showingLikes ? <LikedSongs songs={favorites} /> : <SavedCollection key={selection} kind={kind as CollectionKind} id={id} />}
  </div>;

  if (!shelf || !favorites || !app.ready) {
    if (loadError) return <div className="center"><p className="sub" role="alert">{loadError}</p><button className="btn ghost sm" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
    return <div className="library-shelf-loading" aria-busy="true">
      <div className="grid library-shelf" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="library-skeleton"><i /><span /></div>)}</div>
      <Loading label="正在加载音乐库" />
    </div>;
  }

  const bookmarks = [...shelf.items].sort((a, b) => Number(b.kind === 'album') - Number(a.kind === 'album'));
  const defaults: Card[] = [
    { key: 'likes', name: '我的喜欢', cover: null, sub: `${favorites.length} 首` },
    ...app.playlists.map(item => ({ key: `mine:${item.id}`, name: item.name, cover: item.cover, sub: `我的歌单 · ${item.trackCount} 首` })),
    ...bookmarks.map(item => ({ key: `${item.kind}:${item.id}`, name: item.name, cover: item.cover, bookmark: item,
      sub: item.available ? [item.kind === 'album' ? '收藏的专辑' : '收藏的歌单', item.sub].filter(Boolean).join(' · ') : '已不可用' })),
  ];
  const byKey = new Map(defaults.map(card => [card.key, card]));
  const order = [...new Set([...shelf.order, ...byKey.keys()])].filter(key => byKey.has(key));

  async function saveOrder(next: string[]) {
    if (savingOrder.current) return;
    const previous = shelf!.order;
    savingOrder.current = true;
    setSaving(true);
    setShelf(value => value && { ...value, order: next });
    try {
      const saved = await put<{ order: string[] }>('/api/me/collections', { order: next });
      setShelf(value => value && { ...value, order: saved.order });
    } catch (error) {
      setShelf(value => value && { ...value, order: previous });
      app.toast(errorMessage(error));
    } finally {
      savingOrder.current = false;
      setSaving(false);
    }
  }

  async function removeBookmark(item: CollectionFavorite) {
    if (removing) return;
    setRemoving(`${item.kind}:${item.id}`);
    try {
      await del(`/api/me/collections/${item.kind}/${item.id}`);
      setShelf(value => value && { ...value, items: value.items.filter(bookmark => bookmark.kind !== item.kind || bookmark.id !== item.id) });
      window.dispatchEvent(new Event('nt:collection-change'));
    } catch (error) { app.toast(errorMessage(error)); }
    finally { setRemoving(''); }
  }

  return <>
    <div className="row library-import-action"><PlaylistImport /></div>
    {loadError && <p className="err" role="alert">{loadError}</p>}
    <SortableLibraryGrid order={order} disabled={saving} onReorder={next => void saveOrder(next)} name={key => byKey.get(key)?.name ?? key}>
      {key => {
        const card = byKey.get(key)!;
        const content = <>
          {key === 'likes' ? <span className="library-likes-cover"><Icon n="heart" s={44} /></span> : <Cover src={card.cover} seed={key} />}
          <b className="t1">{card.name}</b><span className="sub sm t1">{card.sub}</span>
        </>;
        return <>
          {card.bookmark?.available === false ? <div className="card">{content}</div> :
            <Link className="card" href={collectionLink(key)} draggable={false} scroll={false}>{content}</Link>}
          {card.bookmark && <button className="link sm" disabled={!!removing} aria-label={`取消收藏 ${card.name}`} onClick={() => void removeBookmark(card.bookmark!)}>{removing === key ? <Loading inline /> : '取消收藏'}</button>}
        </>;
      }}
    </SortableLibraryGrid>
  </>;
}

function LikedSongs({ songs }: { songs: Song[] | null }) {
  const app = useApp();
  if (!songs) return <Loading />;
  return <>
    <Hero seed="favorites" cover={songs[0]?.cover} title="我的喜欢" sub={`${songs.length} 首`}>
      <button className="btn light" disabled={!songs.length} onClick={() => app.play(songs)}><Icon n="play" s={16} />播放全部</button>
    </Hero>
    <div className="library-detail-songs">{songs.length ? <SongList songs={songs} /> : <Empty text="点歌曲旁的爱心，把它添加到我的喜欢。" />}</div>
  </>;
}

function SavedCollection({ kind, id }: { kind: CollectionKind; id: string }) {
  const app = useApp();
  const [detail, setDetail] = useState<{ meta: Metadata; songs: Song[]; folders?: PlaylistFolder[]; directSongs?: Song[] } | null>(null);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const url = `/api/${routes[kind]}/${encodeURIComponent(id)}`;

  useEffect(() => {
    let active = true;
    get<CollectionPage>(kind === 'playlist' ? `${url}?limit=100` : url).then(result => {
      if (!active) return;
      const meta = result.album ?? result.playlist;
      if (meta) setDetail({ meta, songs: result.songs, folders: result.folders, directSongs: result.directSongs });
      else setError('无法读取收藏详情');
    }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [kind, url]);

  if (!detail) return error ? <p className="note" role="alert">{error}</p> : <Loading />;
  const { meta, songs, folders, directSongs } = detail;
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
      <SaveFolderToPlaylist source={{ kind: kind === 'playlist' ? 'netease' : kind, id }} />
      {kind === 'mine' && <Link className="btn ghost" href={`/my/${id}`}>管理歌单</Link>}
    </Hero>
    <div className="library-detail-songs">{folders && <PlaylistFolders folders={folders} />}{(directSongs ?? songs).length ? <SongList songs={directSongs ?? songs} /> : !folders?.length && <Empty text="暂无歌曲。" />}</div>
    {error && <p className="err" role="alert">{error}</p>}
    {kind === 'playlist' && songs.length < total && <div className="center"><button className="btn ghost" disabled={fetching} onClick={() => void more(false)}>{fetching ? '加载中…' : '加载更多'}</button></div>}
  </>;
}
