'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { del, get, patch } from '@/lib/api';
import { useApp } from '@/lib/app';
import { SharePlaylist } from '@/components/SharePlaylist';
import type { PlaylistLite, Song } from '@/lib/types';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { Empty, Loading, SongList } from '@/components/SongList';

export default function MyPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const router = useRouter();
  const [pl, setPl] = useState<PlaylistLite | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [preparingShare, setPreparingShare] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    setPl(null); setErr('');
    get(`/api/me/playlists/${id}`).then(r => { setPl(r.playlist); setSongs(r.songs); setName(r.playlist.name); }).catch(e => setErr(e.message));
  }, [id]);

  async function rename() {
    try { const r = await patch(`/api/me/playlists/${id}`, { name }); setPl(r.playlist); setEditing(false); app.reloadPlaylists(); }
    catch (e: any) { app.toast(e.message); }
  }
  async function remove() {
    if (!confirm(`确定删除歌单「${pl?.name}」吗？`)) return;
    try { await del(`/api/me/playlists/${id}`); await app.reloadPlaylists(); router.push('/'); app.toast('歌单已删除'); }
    catch (e: any) { app.toast(e.message); }
  }
  async function removeSong(s: Song) {
    try { await del(`/api/me/playlists/${id}/songs/${s.id}`); setSongs(p => p.filter(x => x.id !== s.id)); app.reloadPlaylists(); }
    catch (e: any) { app.toast(e.message); }
  }
  async function publish(value: boolean) {
    const result = await patch(`/api/me/playlists/${id}`, { isPublic: value });
    setPl(result.playlist); await app.reloadPlaylists();
  }
  async function prepareShare() {
    if (preparingShare) return;
    setPreparingShare(true);
    try {
      if (!app.me?.profilePublic) throw new Error('请先在设置中开启公开个人主页');
      if (!pl?.isPublic) await publish(true);
      setSharing(true);
    } catch (e) { app.toast(e instanceof Error ? e.message : '分享失败'); }
    finally { setPreparingShare(false); }
  }

  if (err) return <div className="note">{err}</div>;
  if (!pl) return <Loading />;
  return (
    <>
      <Hero cover={songs[0]?.cover} seed={`pl${pl.id}`} tag="我的歌单" title={pl.name} sub={`${songs.length} 首歌曲`}>
        <button className="btn light" onClick={() => app.play(songs)} disabled={!songs.length}><Icon n="play" s={16} />播放全部</button>
        <button className="btn ghost" onClick={() => setEditing(true)}>重命名</button>
        <button className="btn ghost" disabled={preparingShare} onClick={prepareShare}>{preparingShare ? <Loading inline label="正在准备分享" /> : '分享'}</button>
        <button className="btn ghost" aria-pressed={!!pl.isPublic} onClick={() => publish(!pl.isPublic).catch(e => app.toast(e.message))}>{pl.isPublic ? '公开' : '私密'}</button>
        <button className="btn ghost" onClick={remove}><Icon n="trash" s={16} />删除</button>
      </Hero>
      {sharing && <SharePlaylist playlist={pl} onClose={() => setSharing(false)} />}
      {editing && (
        <form className="row" style={{ marginTop: 20 }} onSubmit={e => { e.preventDefault(); rename(); }}>
          <div className="field" style={{ margin: 0, flex: 1, maxWidth: 360 }}><input value={name} maxLength={40} onChange={e => setName(e.target.value)} autoFocus /></div>
          <button className="btn sm" disabled={!name.trim()}>保存</button><button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>取消</button>
        </form>
      )}
      <div style={{ marginTop: 26 }}>
        {songs.length ? <SongList songs={songs} onRemove={removeSong} /> : <Empty text="这个歌单还是空的。在任意歌曲的「更多」菜单里可以添加到歌单。" />}
      </div>
    </>
  );
}
