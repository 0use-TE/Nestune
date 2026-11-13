'use client';
import { useState } from 'react';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import { post } from '@/lib/api';
import type { PlaylistLite } from '@/lib/types';
import { Sheet } from './Sheet';
import { Avatar } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';

export function SharePlaylist({ playlist, onClose }: { playlist: PlaylistLite; onClose: () => void }) {
  const app = useApp();
  const social = useSocial();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<number | 'copy' | null>(null);
  const [sent, setSent] = useState<number[]>([]);
  const friends = (social.state?.people ?? social.directory ?? []).filter(person => person.friendship === 'friend' && `${person.name} ${person.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function share(peer?: number) {
    if (busy !== null) return;
    setBusy(peer ?? 'copy');
    try {
      if (peer === undefined) {
        await navigator.clipboard.writeText(new URL(`/shared/${playlist.id}`, location.origin).href);
        app.toast('链接已复制'); onClose();
      } else {
        await post('/api/social', { action: 'sharePlaylist', peerId: peer, playlistId: playlist.id });
        setSent(current => [...current, peer]); app.toast('歌单已发送');
      }
    } catch (e) { app.toast(e instanceof Error ? e.message : '分享失败'); }
    finally { setBusy(null); }
  }
  return <Sheet title="分享歌单" onClose={onClose} className="share-playlist-sheet">
    <button type="button" className="btn ghost share-copy" disabled={busy !== null} onClick={() => share()}><Icon n="link" s={18} />{busy === 'copy' ? <Loading inline /> : '复制链接'}</button>
    <label className="search"><Icon n="search" s={17} /><input aria-label="搜索好友" placeholder="搜索好友" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="share-recipients">
      {!social.state && !social.directory ? <Loading /> : !friends.length ? <div className="center sub">{query ? '没有找到好友' : '暂无好友'}</div> : friends.map(person => <button type="button" key={person.id} className="share-recipient" disabled={busy !== null || sent.includes(person.id)} onClick={() => share(person.id)}>
        <Avatar src={person.avatar} name={person.name} /><b className="t1">{person.name}</b><span className="sub sm">{busy === person.id ? <Loading inline /> : sent.includes(person.id) ? '已发送' : '发送'}</span>
      </button>)}
    </div>
  </Sheet>;
}
