'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { del, get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { Empty, Loading, SongList } from '@/components/SongList';
import { FavoriteCollections } from '@/components/CollectionFavorite';
import { Icon } from '@/components/Icon';

const TABS = [['favorites', '收藏'], ['history', '历史'], ['local', '本地'], ['uploads', '上传歌曲']] as const;

export default function LibraryPage() {
  return <Suspense fallback={<Loading />}><Library /></Suspense>;
}

function Library() {
  const app = useApp();
  const params = useSearchParams();
  const requested = params.get('tab');
  const category = params.get('kind') === 'album' ? 'album' : params.get('kind') === 'playlist' ? 'playlist' : 'song';
  const tab = TABS.find(([key]) => key === requested)?.[0] ?? 'favorites';
  const [result, setResult] = useState<{ tab: typeof tab; songs: Song[] } | null>(null);

  // keep the favourites list in step with the heart buttons
  useEffect(() => {
    let live = true;
    setResult(null);
    document.getElementById('main')?.scrollTo({ top: 0 });
    if (tab === 'local' || tab === 'uploads' || tab === 'favorites' && category !== 'song') return;
    const url = tab === 'favorites' ? '/api/me/favorites' : '/api/me/history?limit=100';
    get<{ songs: Song[] }>(url).then(r => {
      if (live) setResult({ tab, songs: r.songs });
    }).catch(e => { if (live) { app.toast(e.message); setResult({ tab, songs: [] }); } });
    return () => { live = false; };
  }, [tab, category, app.toast]);

  const songs = result?.tab === tab ? result.songs : null;
  const shown = tab === 'favorites' && songs ? songs.filter(s => app.favIds.has(s.id)) : songs;

  async function clearHistory() {
    if (!confirm('确定清空播放历史吗？')) return;
    try {
      await del('/api/me/history');
      setResult(current => current?.tab === 'history' ? { ...current, songs: [] } : current);
    } catch (e: any) { app.toast(e.message); }
  }

  return (
    <>
      <div className="library-heading">
        <h1>音乐库</h1>
        <div className="library-tab-row">
          <nav className="tabs" aria-label="音乐库">{TABS.map(([key, label]) => (
            <Link key={key} href={key === 'favorites' ? '/library' : `/library?tab=${key}`} replace scroll={false}
              className={`tab ${tab === key ? 'on' : ''}`} aria-current={tab === key ? 'page' : undefined}>{label}</Link>
          ))}</nav>
          {tab === 'local' && app.deviceMusic.status === 'ready' && <DeviceRefreshButton refresh={app.deviceMusic.refresh} />}
        </div>
      </div>
      {tab === 'favorites' && <nav className="chips" aria-label="收藏分类">{[['song','歌曲'],['album','专辑'],['playlist','歌单']].map(([key,label]) => <Link key={key} className={`chip ${category === key ? 'on' : ''}`} aria-current={category === key ? 'page' : undefined} href={key === 'song' ? '/library' : `/library?kind=${key}`} replace scroll={false}>{label}</Link>)}</nav>}
      {tab === 'history' && shown && shown.length > 0 && <div style={{ textAlign: 'right', marginBottom: 6 }}><button className="link" onClick={clearHistory}>清空历史</button></div>}
      {tab === 'favorites' && category !== 'song' ? <FavoriteCollections category={category} /> : tab === 'local' ? <DeviceLibrary /> : tab === 'uploads' ? <UploadLibrary /> : shown === null ? <Loading /> : shown.length === 0
        ? <Empty text={tab === 'favorites' ? '还没有收藏的歌曲，点歌曲旁边的爱心即可收藏。' : '还没有播放记录。'} />
        : <SongList songs={shown} />}
    </>
  );
}

function UploadLibrary() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    get<{ items: Song[]; total: number }>('/api/uploads').then(data => {
      if (live) { setSongs(data.items); setTotal(data.total); }
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, []);
  async function loadMore() {
    if (!songs || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await get<{ items: Song[]; total: number }>(`/api/uploads?offset=${songs.length}`);
      setSongs([...songs, ...data.items]);
      setTotal(data.total);
    } catch (error) { setError(error instanceof Error ? error.message : '无法加载歌曲'); }
    finally { setBusy(false); }
  }
  return <>
    {error && <p className="err" role="alert">{error}</p>}
    {!songs && !error && <Loading />}
    {songs?.length === 0 && <Empty text="暂无可播放的上传歌曲。在个人设置的「我的上传」添加歌曲。" />}
    {songs && <SongList songs={songs} />}
    {songs && songs.length < total && <div className="center"><button className="btn ghost sm" onClick={loadMore} disabled={busy}>{busy ? <Loading inline label="加载中" /> : '加载更多'}</button></div>}
  </>;
}

function DeviceLibrary() {
  const { deviceMusic } = useApp();
  const { status, songs, connect, refresh } = deviceMusic;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void refresh(); }, [refresh]);

  async function update() {
    setBusy(true);
    setError('');
    try { await connect(); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setError(error instanceof Error ? error.message : '无法读取音乐文件夹');
      }
    } finally { setBusy(false); }
  }

  if (status === 'loading') return <Loading />;
  if (status === 'insecure') return <div className="note">请通过 HTTPS 或 localhost 打开 Nestune，以读取此设备的音乐文件夹。</div>;
  if (status === 'unsupported') return <div className="note">当前浏览器无法读取系统音乐文件夹，请用支持文件夹访问的桌面浏览器打开。</div>;
  if (status === 'ready') return songs.length ? <SongList songs={songs} /> : <Empty text="音乐文件夹里没有可播放的音频文件。" />;

  return <>
    <div className="note row device-library-note">
      <span>{status === 'error'
        ? '无法读取音乐文件夹，请检查文件夹和浏览器权限。'
        : '首次使用时，请在浏览器弹窗中确认系统的「音乐」文件夹。'}</span>
      <button className="btn ghost sm" disabled={busy} onClick={update}>
        {busy ? <Loading inline label="正在读取音乐" /> : status === 'error' ? '重试' : '授权音乐文件夹'}
      </button>
    </div>
    {error && <p className="err" role="alert">{error}</p>}
  </>;
}

function DeviceRefreshButton({ refresh }: { refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try { await refresh(); }
    finally { setBusy(false); }
  }

  return <button type="button" className="ib device-library-refresh" aria-label="刷新本地音乐" title="刷新本地音乐"
    disabled={busy} aria-busy={busy} onClick={reload}><Icon n="refresh" s={18} /></button>;
}
