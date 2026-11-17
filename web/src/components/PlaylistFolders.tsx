'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { del, get, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { FolderSource, PlaylistFolder } from '@/lib/playlist-folders';
import type { CollectionFavorite } from '@/lib/collection-types';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Loading, SongList } from './SongList';
import { CanvasSource } from './CanvasSource';

export function PlaylistFolders({ folders, parent, onChange }: { folders: PlaylistFolder[]; parent?: string; onChange?: () => void }) {
  const app = useApp(), [removing, setRemoving] = useState<number | null>(null);
  async function remove(folder: PlaylistFolder) {
    setRemoving(folder.id);
    try { await del(`/api/me/playlists/${parent}/folders?folder=${folder.id}`); await app.reloadPlaylists(); onChange?.(); }
    catch (error) { app.toast(error instanceof Error ? error.message : '无法移出'); }
    finally { setRemoving(null); }
  }
  return <div className="playlist-folders">{folders.map(folder => <details key={folder.id} className="playlist-folder panel">
    <summary><Cover src={folder.cover} seed={folder.targetId} /><span className="playlist-folder-name"><b>{folder.name}</b><small className="sub">{!folder.available ? '已不可访问' : `${folder.kind === 'album' ? '专辑' : '歌单'} · ${folder.songs.length} 首 · ${folder.readonly ? '只读' : '我的文件夹'}`}</small></span><Icon n="down" s={16} /></summary>
    <div className="playlist-folder-content"><div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
      <CanvasSource queue source={folder.kind === 'album' ? { kind: 'album', albumId: folder.targetId, name: folder.name, cover: folder.cover } : { kind: 'queue', songIds: folder.songs.map(s => s.id), name: folder.name, cover: folder.cover }}><button className="btn ghost sm" disabled={!folder.songs.length} onClick={() => app.play(folder.songs)}><Icon n="play" s={15} />播放这个文件夹</button></CanvasSource>
      {!folder.readonly && <Link className="btn ghost sm" href={`/my/${folder.targetId}`}>编辑原歌单</Link>}
      {parent && <button className="btn ghost sm" disabled={removing !== null} onClick={() => void remove(folder)}>{removing === folder.id ? '正在移出…' : '从这里移出'}</button>}
    </div>
      {folder.folders.length > 0 && <PlaylistFolders folders={folder.folders} />}
      {folder.available && folder.directSongs.length > 0 && <SongList songs={folder.directSongs} />}
    </div>
  </details>)}</div>;
}

export function AddPlaylistFolder({ parent, onChange }: { parent: string; onChange: () => void }) {
  const app = useApp(); const [open, setOpen] = useState(false), [items, setItems] = useState<CollectionFavorite[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [link, setLink] = useState('');
  useEffect(() => { if (open) get<{ items: CollectionFavorite[] }>('/api/me/collections').then(data => setItems(data.items)).catch(error => setError(error.message)); }, [open]);
  async function add(source?: FolderSource) {
    if (busy) return; setBusy(true); setError('');
    try {
      if (!source) { const result = await post('/api/me/playlist-import', { link }); source = { kind: result.provider, id: result.id }; }
      await post(`/api/me/playlists/${parent}/folders`, source); await app.reloadPlaylists(); onChange(); setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : '无法添加'); }
    finally { setBusy(false); }
  }
  return <><button className="btn ghost" onClick={() => setOpen(true)}><Icon n="plus" s={16} />放入专辑 / 歌单</button>{open && <Sheet title="放入一个文件夹" onClose={() => { if (!busy) setOpen(false); }}><div className="collection-form">
    <p className="sub sm">专辑和别人的歌单保持只读。自己的歌单可进入原歌单编辑。</p>
    {app.playlists.filter(p => String(p.id) !== parent).map(p => <button disabled={busy} className="collection-folder-choice" key={`mine:${p.id}`} onClick={() => void add({ kind: 'mine', id: String(p.id) })}><Cover src={p.cover} seed={p.name} /><span><b>{p.name}</b><small className="sub">我的歌单 · {p.trackCount} 首</small></span><Icon n="plus" s={16} /></button>)}
    {items.filter(item => item.available && ['album','shared','playlist'].includes(item.kind)).map(item => <button disabled={busy} className="collection-folder-choice" key={`${item.kind}:${item.id}`} onClick={() => void add({ kind: item.kind === 'playlist' ? 'netease' : item.kind as FolderSource['kind'], id: item.id })}><Cover src={item.cover} seed={item.id} /><span><b>{item.name}</b><small className="sub">{item.kind === 'album' ? '收藏的专辑' : '收藏的歌单'} · 只读</small></span><Icon n="plus" s={16} /></button>)}
    <form onSubmit={event => { event.preventDefault(); void add(); }}><label className="field">也可以粘贴平台歌单链接<input value={link} maxLength={2000} onChange={event => setLink(event.target.value)} placeholder="网易云 / QQ 音乐歌单链接" /></label><button className="btn ghost sm" disabled={busy || !link.trim()}>放入只读歌单</button></form>
    {busy && <Loading inline label="正在放入文件夹" />}{error && <p className="err" role="alert">{error}</p>}
  </div></Sheet>}</>;
}

export function SaveFolderToPlaylist({ source }: { source: FolderSource }) {
  const app = useApp(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  return <><button className="btn ghost" onClick={() => setOpen(true)}>放进我的歌单</button>{open && <Sheet title="选择你的歌单" onClose={() => { if (!busy) setOpen(false); }}><div className="collection-form">{app.playlists.map(item => <button className="collection-folder-choice" disabled={busy} key={item.id} onClick={async () => { setBusy(true); try { await post(`/api/me/playlists/${item.id}/folders`, source); await app.reloadPlaylists(); setOpen(false); app.toast('已放进歌单'); } catch (error) { app.toast(error instanceof Error ? error.message : '无法添加'); } finally { setBusy(false); } }}><Cover src={item.cover} seed={item.name} /><span>{item.name}</span><Icon n="plus" s={16} /></button>)}{!app.playlists.length && <p className="sub">先创建一个自己的歌单，再把专辑放进去。</p>}</div></Sheet>}</>;
}
