'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { Song } from '@/lib/types';
import { Sheet } from './Sheet';
import { Cover } from './Cover';
import { Loading } from './Loading';

export function PlaylistImport() {
  const app = useApp(), router = useRouter();
  const [open, setOpen] = useState(false), [link, setLink] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; cover: string | null; songs: Song[]; provider: string; skipped?: number } | null>(null);
  async function load(confirm = false) {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await post('/api/me/playlist-import', { link, confirm });
      if (confirm) { await app.reloadPlaylists(); window.dispatchEvent(new Event('nt:collection-change')); setOpen(false); setPreview(null); setLink(''); app.toast(`已导入 ${result.imported} 首歌曲${result.skipped ? `，跳过 ${result.skipped} 首不可读取歌曲` : ''}`); router.push(`/my/${result.playlist.id}`); }
      else setPreview(result);
    } catch (error) { setError(error instanceof Error ? error.message : '无法导入'); }
    finally { setBusy(false); }
  }
  return <><button className="btn ghost sm" onClick={() => setOpen(true)}>导入歌单</button>{open && <Sheet title="导入歌单" onClose={() => { if (!busy) setOpen(false); }}>
    <form onSubmit={event => { event.preventDefault(); void load(!!preview); }} className="collection-form">
      <label className="field">网易云 / QQ 音乐分享链接<textarea rows={3} maxLength={2000} required placeholder="粘贴歌单分享链接或分享文字" value={link} disabled={busy} onChange={event => { setLink(event.target.value); setPreview(null); setError(''); }} /></label>
      {!preview && <p className="sub sm">读取可访问的歌单，保留歌曲来源和顺序。导入后成为你可以编辑的新歌单。</p>}
      {preview && <><div className="collection-import-preview"><Cover src={preview.cover} seed={preview.name} /><div><b>{preview.name}</b><p className="sub sm">{preview.provider === 'qq' ? 'QQ 音乐' : '网易云'} · {preview.songs.length} 首</p></div></div><div className="collection-import-tracks">{preview.songs.slice(0, 8).map(song => <p key={song.id}>{song.name}<span className="sub sm"> · {song.artists.map(a => a.name).join(' / ')}</span></p>)}{preview.songs.length > 8 && <p className="sub sm">还有 {preview.songs.length - 8} 首</p>}</div></>}
      {error && <p className="err" role="alert">{error}</p>}
      {!!preview?.skipped && <p className="sub sm">网易云未提供其中 {preview.skipped} 首，确认后只导入上面可读取的歌曲。</p>}
      <button className="btn" disabled={busy || !link.trim()}>{busy ? <Loading inline label={preview ? '正在导入' : '正在读取歌单'} /> : preview ? '确认导入' : '预览歌单'}</button>
    </form>
  </Sheet>}</>;
}
