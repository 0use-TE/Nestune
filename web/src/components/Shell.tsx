'use client';
import { Loading } from './Loading';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import { useOptionalSocial } from '@/lib/social';
import type { Song, Tier } from '@/lib/types';
import { fmtBytes, unplayableText } from '@/lib/util';
import { Avatar, Cover } from './Cover';
import { Icon } from './Icon';
import { Login } from './Login';
import { NowPlaying } from './NowPlaying';
import { PlayerBar } from './PlayerBar';
import { QueuePopover } from './PlaybackQueue';
import { StartupLoading } from './StartupLoading';

const NAV = [['/', '首页', 'home'], ['/search', '搜索', 'search'], ['/library', '音乐库', 'lib'], ['/social', '一起听', 'users'], ['/chat', '聊天', 'lyrics']] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const unread = useOptionalSocial()?.state?.inbox?.reduce((total, thread) => total + thread.unread, 0) ?? 0;
  const path = usePathname();
  const main = useRef<HTMLElement>(null);
  const [newPl, setNewPl] = useState<{ song?: Song } | null>(null);
  const [lyricsPinned, setLyricsPinned] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const toggleQueue = () => setQueueOpen(open => !open);
  const toggleLyrics = () => setLyricsPinned(pinned => !pinned);
  const hasSong = !!app.current;

  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [path]);
  useEffect(() => { if (!app.me) setLyricsPinned(false); }, [app.me]);
  useEffect(() => { closeQueue(); }, [app.nowOpen, hasSong, closeQueue]);
  useEffect(() => {
    const h = (e: Event) => setNewPl({ song: (e as CustomEvent).detail?.song });
    window.addEventListener('nt:new-playlist', h);
    return () => window.removeEventListener('nt:new-playlist', h);
  }, []);

  if (!app.ready) return <StartupLoading fullscreen />;
  if (!app.me) return <><Login /><Toasts /></>;
  const on = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <>
      <div id="app">
        <aside>
          <div className="brand"><span className="logo" />Nestune</div>
          {NAV.map(([href, label, icon]) => (
            <Link key={href} href={href} className={`nav ${on(href) ? 'on' : ''}`} aria-label={href === '/chat' && unread ? `聊天，${unread} 条未读` : undefined}><Icon n={icon} s={19} />{label}{href === '/chat' && unread > 0 && <UnreadCount count={unread} />}</Link>
          ))}
          <div className="lab">我的歌单<button aria-label="新建歌单" onClick={() => setNewPl({})}><Icon n="plus" s={16} /></button></div>
          <Link href="/library" className="pl">
            <span className="favorites-cover" aria-hidden="true"><Icon n="heart" s={16} /></span>
            <span className="t1">我喜欢的音乐</span>
          </Link>
          {app.playlists.map(p => (
            <Link key={p.id} href={`/my/${p.id}`} className={`pl ${path === `/my/${p.id}` ? 'on' : ''}`}>
              <Cover src={p.cover} seed={`pl${p.id}`} /><span className="t1">{p.name}</span>
            </Link>
          ))}
          <div className="sp" />
          <Link href="/settings" className={`me ${path === '/settings' ? 'on' : ''}`}>
            <Avatar src={app.me.avatar} name={app.me.displayName} />
            <span style={{ minWidth: 0 }}><b className="t1" style={{ display: 'block' }}>{app.me.displayName}</b><span className="muted sm">个人资料与设置</span></span>
          </Link>
        </aside>
        <main id="main" ref={main}><div className="wrap">{children}</div></main>
      </div>
      <nav id="tabbar">
        {[...NAV, ['/settings', '我的', 'user'] as const].map(([href, label, icon]) => (
          <Link key={href} href={href} className={on(href) ? 'on' : ''} aria-label={href === '/chat' && unread ? `聊天，${unread} 条未读` : undefined}><Icon n={icon} s={21} />{label}{href === '/chat' && unread > 0 && <UnreadCount count={unread} />}</Link>
        ))}
      </nav>
      <PlayerBar lyricsPinned={lyricsPinned} onToggleLyrics={toggleLyrics} queueOpen={queueOpen && !app.nowOpen} onToggleQueue={toggleQueue} onDetails={() => { closeQueue(); app.setNowOpen(true); }} />
      <NowPlaying lyricsPinned={lyricsPinned} onToggleLyrics={toggleLyrics} queueOpen={queueOpen && app.nowOpen} onToggleQueue={toggleQueue} />
      {queueOpen && app.current && <QueuePopover inPlayer={app.nowOpen} onClose={closeQueue} />}
      <SongMenu onNewPlaylist={s => setNewPl({ song: s })} />
      {app.saveDialog && <SaveDialog song={app.saveDialog} />}
      {newPl && <NewPlaylist song={newPl.song} onClose={() => setNewPl(null)} />}
      <Toasts />
    </>
  );
}

function UnreadCount({ count }: { count: number }) {
  return <span className="unread-count nav-unread" aria-hidden="true">{count > 99 ? '99+' : count}</span>;
}

function Toasts() {
  const { toasts } = useApp();
  return <>
    <div className="toasts" role="status">
      {toasts.filter(t => !t.kind).map(t => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
    <div className="toasts social-toasts" role="status">
      {toasts.filter(t => t.kind).map(t => (
        <div key={t.id} className="toast">
          <span aria-hidden="true"><Icon n={t.kind === 'invite' ? 'users' : 'lyrics'} s={17} /></span>
          {t.text}
        </div>
      ))}
    </div>
  </>;
}

function SongMenu({ onNewPlaylist }: { onNewPlaylist: (s: Song) => void }) {
  const app = useApp();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const m = app.menu;

  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) app.closeMenu(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && app.closeMenu();
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [m, app]);
  if (!m) return null;

  const s = m.song, fav = app.favIds.has(s.id), device = isDeviceSong(s.id);
  const w = 232, h = Math.min(window.innerHeight * 0.7, 120 + 40 * (6 + app.playlists.length));
  const x = Math.min(m.x, window.innerWidth - w - 12), y = Math.min(m.y, window.innerHeight - h - 12);
  const run = (fn: () => void) => () => { app.closeMenu(); fn(); };
  const addTo = async (id: number) => {
    app.closeMenu();
    try { const r = await post(`/api/me/playlists/${id}/songs`, { songId: s.id }); app.toast(r.added ? '已添加到歌单' : '歌单里已经有这首歌了'); app.reloadPlaylists(); }
    catch (e: any) { app.toast(e.message); }
  };

  return (
    <div className="menu" ref={ref} style={{ left: x, top: Math.max(12, y), width: w }}>
      <button onClick={run(() => app.playNext(s))}><Icon n="next1" s={18} />下一首播放</button>
      <button onClick={run(() => app.enqueue(s))}><Icon n="list" s={18} />加入播放队列</button>
      {!device && <>
        <button onClick={run(() => app.toggleFav(s))}><Icon n="heart" s={18} />{fav ? '取消收藏' : '收藏'}</button>
        <button onClick={run(() => app.openSave(s))}><Icon n="download" s={18} />下载到设备…</button>
        <hr /><div className="hd">添加到歌单</div>
        {app.playlists.map(p => <button key={p.id} onClick={() => addTo(p.id)}><Icon n="note" s={18} /><span className="t1">{p.name}</span></button>)}
        <button onClick={run(() => onNewPlaylist(s))}><Icon n="plus" s={18} />新建歌单…</button>
        <hr />
        {s.album.id && <button onClick={run(() => router.push(`/album/${s.album.id}`))}><Icon n="disk" s={18} />查看专辑</button>}
        {s.artists[0]?.id && <button onClick={run(() => router.push(`/artist/${s.artists[0].id}`))}><Icon n="user" s={18} />查看歌手</button>}
      </>}
    </div>
  );
}

function NewPlaylist({ song, onClose }: { song?: Song; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await post('/api/me/playlists', { name });
      if (song) await post(`/api/me/playlists/${r.playlist.id}/songs`, { songId: song.id });
      await app.reloadPlaylists(); onClose(); app.toast(song ? '已创建歌单并添加' : '歌单已创建');
      if (!song) router.push(`/my/${r.playlist.id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="mask" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>新建歌单</h2>
        {song && <p className="sub" style={{ margin: '6px 0 0' }}>创建后会自动添加《{song.name}》</p>}
        <div className="field" style={{ marginTop: 18 }}><label className="sm sub">歌单名称</label><input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoFocus required placeholder="例如 通勤路上" /></div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost sm" onClick={onClose}>取消</button>
          <button className="btn sm" disabled={busy || !name.trim()}>创建</button>
        </div>
      </form>
    </div>
  );
}

type Plan = { playable: boolean; reason?: string; tiers: Tier[]; best: string | null; canDownload?: boolean };

/** Lets the user see every quality tier (format, bitrate, size, and why one is unavailable) before saving. */
function SaveDialog({ song }: { song: Song }) {
  const app = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [includeLyrics, setIncludeLyrics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = app.deviceMusic.status;
  const blocked = status === 'insecure' || status === 'unsupported' || status === 'loading';

  useEffect(() => {
    let live = true;
    setPlan(null);
    get(`/api/songs/${song.id}/qualities`)
      .then((r: Plan) => { if (live) { setPlan(r); setPick(r.best); } })
      .catch(e => live && setPlan({ playable: false, reason: e.message, tiers: [], best: null }));
    return () => { live = false; };
  }, [song.id]);

  const note: Record<Tier['state'], string> = { ok: '', over_cap: '超出你的音质上限', no_access: '音源账号没有此音质的权限', missing: '这首歌没有此音质' };
  async function save() {
    if (!pick || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await app.deviceMusic.download(song, pick, includeLyrics);
      app.closeSave();
      const missing = [song.cover && !result.coverSaved && '封面', includeLyrics && !result.lyricsSaved && '歌词'].filter(Boolean);
      app.toast(missing.length ? `音频已下载，未能保存${missing.join('和')}` : '已下载到设备的音乐文件夹');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setError(error instanceof Error ? error.message : '下载失败，请稍后重试');
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="mask" onMouseDown={e => !busy && e.target === e.currentTarget && app.closeSave()}>
      <div className="modal">
        <h2>下载到设备</h2>
        <p className="sub t1" style={{ margin: '6px 0 16px' }}>{song.name} · {song.artists.map(a => a.name).join(' / ')}</p>
        {status === 'insecure' && <div className="note">请通过 HTTPS 或 localhost 打开 Nestune，以授权设备的音乐文件夹。</div>}
        {status === 'unsupported' && <div className="note">当前浏览器无法访问系统音乐文件夹，请用支持文件夹访问的桌面浏览器打开。</div>}
        {status === 'authorize' && <p className="sub sm" style={{ marginBottom: 12 }}>请在浏览器弹窗里授权系统的「音乐」文件夹。</p>}
        {!plan && <Loading label="正在查询可用音质" />}
        {plan?.canDownload === false && <div className="note">此账号没有下载权限。</div>}
        {plan && !plan.playable && <div className="note">{unplayableText(plan.reason)}：{plan.reason}</div>}
        {plan?.playable && plan.canDownload !== false && (
          <div style={{ display: 'grid', gap: 8 }}>
            {plan.tiers.map(t => {
              const ok = t.state === 'ok', on = pick === t.level;
              return (
                <button key={t.level} disabled={!ok || busy} onClick={() => setPick(t.level)} className="qrow" data-on={on} data-off={!ok}>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <b>{t.label}</b> <span className="sub sm">{t.format}{t.bitrate ? ` · ${Math.round(t.bitrate / 1000)} kbps` : ''}</span>
                    {!ok && <span className="muted sm" style={{ display: 'block' }}>{note[t.state]}</span>}
                  </span>
                  <span className="sub sm">{t.size ? fmtBytes(t.size) : ''}</span>
                  <span className="qdot">{on && <Icon n="check" s={14} />}</span>
                </button>
              );
            })}
          </div>
        )}
        {plan?.playable && plan.canDownload !== false && !blocked && <label className="download-option sub">
          <input type="checkbox" checked={includeLyrics} disabled={busy} onChange={event => setIncludeLyrics(event.target.checked)} />
          同时下载歌词
        </label>}
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn ghost sm" disabled={busy} onClick={app.closeSave}>取消</button>
          <button className="btn sm" disabled={busy || blocked || !pick || !plan?.playable || plan.canDownload === false} onClick={save}>{busy ? <Loading inline label="正在下载" /> : '下载'}</button>
        </div>
      </div>
    </div>
  );
}
