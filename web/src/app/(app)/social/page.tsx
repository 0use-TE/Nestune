'use client';
import { Loading } from '@/components/Loading';
import { useState } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';

export default function SocialPage() {
  const app = useApp();
  const { state, error, playbackError, action } = useSocial();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const userId = app.me!.id;
  const people = state?.people ?? [];
  const room = state?.rooms.find(item => item.active);
  const invites = state?.rooms.filter(item => !item.active) ?? [];
  const roomPeer = room && people.find(person => person.id === (room.hostId === userId ? room.guestId : room.hostId));
  const search = query.trim().toLocaleLowerCase();
  const shown = people.filter(person => `${person.name} ${person.username}`.toLocaleLowerCase().includes(search));

  async function change(data: Record<string, unknown>) {
    setBusy(true);
    try {
      await action(data);
    } catch (e) {
      app.toast(e instanceof Error ? e.message : '操作失败，请稍后重试');
    } finally { setBusy(false); }
  }

  return (
    <div className="social-page">
      <h1>一起听</h1>
      {error && <div className="note" role="status">{error}</div>}
      {room && roomPeer && (room.onThisDevice ? (
        <section className="social-room panel pad" aria-label="一起听房间">
          <div><b>正在与 {roomPeer.name} 一起听</b><div className="sub sm">双方都可以播放或暂停</div></div>
          <div className="row">
            <Link className="btn ghost sm" href={`/chat?peer=${roomPeer.id}`}>聊天</Link>
            <button className="btn ghost sm" disabled={busy} onClick={() => change({ action: 'leave', roomId: room.id })}>结束一起听</button>
          </div>
          {playbackError && <p className="err" role="alert">{playbackError}</p>}
        </section>
      ) : (
        <div className="note" role="status">已在另一台设备与 {roomPeer.name} 一起听</div>
      ))}
      {invites.map(invite => {
        const incoming = invite.guestId === userId;
        const otherId = incoming ? invite.hostId : invite.guestId;
        const person = people.find(item => item.id === otherId);
        return (
          <div className="social-room panel pad" key={invite.id}>
            <span>{incoming ? `${person?.name ?? '好友'} 邀请你一起听` : `已邀请 ${person?.name ?? '好友'} 一起听`}</span>
            <div className="row">
              {incoming && <button className="btn sm" disabled={busy || !!room} onClick={() => change({ action: 'acceptInvite', roomId: invite.id })}>接受</button>}
              {invite.onThisDevice
                ? <button className="btn ghost sm" disabled={busy} onClick={() => change({ action: 'leave', roomId: invite.id })}>{incoming ? '拒绝' : '取消邀请'}</button>
                : <small className="sub">邀请由另一台设备发出</small>}
            </div>
          </div>
        );
      })}

      <section className="panel pad social-directory" aria-label="所有用户">
        <div className="social-heading">
          <h2>所有用户</h2>
          <label className="search"><Icon n="search" s={16} /><input aria-label="搜索用户" placeholder="昵称或用户名" value={query} onChange={e => setQuery(e.target.value)} /></label>
        </div>
        {!state && !error && <Loading />}
        {state && !shown.length && <div className="center sub">没有找到用户</div>}
        {shown.map(person => (
          <div className="social-person" key={person.id}>
            <Link href={`/people/${person.id}`} aria-label={`查看 ${person.name} 的主页`}><Avatar src={person.avatar} name={person.name} /></Link>
            <div className="social-person-info">
              <div className="social-person-name"><Link className="t1" href={`/people/${person.id}`}><b>{person.name}</b></Link>{person.id === userId && <span className="sub sm">你</span>}</div>
              <div className="sub sm t1">@{person.username}{person.online !== null && <span className={person.online ? 'social-online' : ''}> · {person.online ? '在线' : '离线'}</span>}</div>
              {person.track && <div className="social-track t1" title={`${person.track.name} · ${person.track.artist}`}>正在听 {person.track.name}{person.track.artist && ` · ${person.track.artist}`}</div>}
            </div>
            {person.id !== userId && <div className="row social-actions">
              {person.friendship === 'friend' && <Link className="btn ghost sm" href={`/chat?peer=${person.id}`}>聊天</Link>}
              {person.friendship === 'outgoing' && <span className="sub sm">已申请</span>}
              {person.friendship === 'incoming' && <>
                <button className="btn sm" disabled={busy} onClick={() => change({ action: 'acceptFriend', peerId: person.id })}>同意</button>
                <button className="link" disabled={busy} onClick={() => change({ action: 'declineFriend', peerId: person.id })}>拒绝</button>
              </>}
              {!person.friendship && <button className="btn ghost sm" disabled={busy} onClick={() => change({ action: 'friend', peerId: person.id })}>加好友</button>}
            </div>}
          </div>
        ))}
      </section>
    </div>
  );
}
