'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { del, get } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { Empty, Loading, SongList } from '@/components/SongList';

const TABS = [['favorites', '收藏'], ['history', '历史'], ['local', '本地']] as const;

export default function LibraryPage() {
  return <Suspense fallback={<Loading />}><Library /></Suspense>;
}

function Library() {
  const app = useApp();
  const requested = useSearchParams().get('tab');
  const tab = TABS.find(([key]) => key === requested)?.[0] ?? 'favorites';
  const [result, setResult] = useState<{ tab: typeof tab; songs: Song[] } | null>(null);

  // keep the favourites list in step with the heart buttons
  useEffect(() => {
    let live = true;
    setResult(null);
    document.getElementById('main')?.scrollTo({ top: 0 });
    if (tab === 'local') return;
    const url = tab === 'favorites' ? '/api/me/favorites' : '/api/me/history?limit=100';
    get<{ songs: Song[] }>(url).then(r => {
      if (live) setResult({ tab, songs: r.songs });
    }).catch(e => { if (live) { app.toast(e.message); setResult({ tab, songs: [] }); } });
    return () => { live = false; };
  }, [tab, app.toast]);

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
        <nav className="tabs" aria-label="音乐库">{TABS.map(([key, label]) => (
          <Link key={key} href={key === 'favorites' ? '/library' : `/library?tab=${key}`} replace scroll={false}
            className={`tab ${tab === key ? 'on' : ''}`} aria-current={tab === key ? 'page' : undefined}>{label}</Link>
        ))}</nav>
      </div>
      {tab === 'history' && shown && shown.length > 0 && <div style={{ textAlign: 'right', marginBottom: 6 }}><button className="link" onClick={clearHistory}>清空历史</button></div>}
      {tab === 'local' ? <DeviceLibrary /> : shown === null ? <Loading /> : shown.length === 0
        ? <Empty text={tab === 'favorites' ? '还没有收藏的歌曲，点歌曲旁边的爱心即可收藏。' : '还没有播放记录。'} />
        : <SongList songs={shown} />}
    </>
  );
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
    try { await (status === 'ready' ? refresh() : connect()); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setError(error instanceof Error ? error.message : '无法读取音乐文件夹');
      }
    } finally { setBusy(false); }
  }

  if (status === 'loading') return <Loading />;
  if (status === 'insecure') return <div className="note">请通过 HTTPS 或 localhost 打开 Nestune，以读取此设备的音乐文件夹。</div>;
  if (status === 'unsupported') return <div className="note">当前浏览器无法读取系统音乐文件夹，请用支持文件夹访问的桌面浏览器打开。</div>;

  return <>
    <div className="note row device-library-note">
      <span>{status === 'ready' ? '音乐文件夹 · 此设备' : status === 'error'
        ? '无法读取音乐文件夹，请检查文件夹和浏览器权限。'
        : '首次使用时，请在浏览器弹窗中确认系统的「音乐」文件夹。'}</span>
      <button className="btn ghost sm" disabled={busy} onClick={update}>
        {busy ? '读取中…' : status === 'ready' ? '重新读取' : '授权音乐文件夹'}
      </button>
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {status === 'ready' && (songs.length ? <SongList songs={songs} /> : <Empty text="音乐文件夹里没有可播放的音频文件。" />)}
  </>;
}
