'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import { LISTENING_ROOM_CAPACITY, type ListeningRoom } from '@/lib/social-types';
import { Avatar } from './Cover';
import { Icon } from './Icon';

export function ListeningRoomControls({ room }: { room: ListeningRoom }) {
  const { me, toast, setNowOpen } = useApp();
  const { action, state } = useSocial();
  const [peer, setPeer] = useState('');
  const [busy, setBusy] = useState(false);
  const group = room.group!;
  const owner = room.hostId === me?.id;
  const friends = state?.people.filter(person => person.friendship === 'friend' && !group.memberIds.includes(person.id) && !group.pendingIds.includes(person.id)) ?? [];
  async function change(data: Record<string, unknown>) {
    setBusy(true);
    try { await action({ ...data, roomId: room.id }); setPeer(''); }
    catch (error) { toast(error instanceof Error ? error.message : '房间操作失败'); }
    finally { setBusy(false); }
  }
  if (room.domain) return <div className="domain-player player-together">
    <Icon n="users" s={19} />
    <Link href={`/social?tab=domains&domain=${room.domain.id}`} className="t1 domain-playing-link" onClick={() => setNowOpen(false)}>{room.domain.name}</Link>
    <button type="button" className="link" disabled={busy} onClick={() => void change({ action:'leave' })}>退出同步</button>
  </div>;
  return <section className="player-together active listening-room" aria-label="一起听房间">
    <header className="together-header">
      <div className="together-status"><b>一起听房间 · {group.memberIds.length}/{LISTENING_ROOM_CAPACITY}</b>
        <small className="sub">{room.playback?.playing ? '播放中' : '已暂停'}{!owner && ' · 由房主控制播放'}</small>
      </div>
      <button type="button" className="link" disabled={busy} onClick={() => void change({ action: 'leave' })}>退出房间</button>
    </header>
    <ul className="listening-members" aria-label="房间成员">
      {group.memberIds.map(id => {
        const person = state?.people.find(item => item.id === id);
        const name = person?.name ?? '成员';
        return <li key={id}><Avatar src={person?.avatar} name={name} /><span className="t1">{name}</span>{id === room.hostId && <small className="sub">房主</small>}</li>;
      })}
    </ul>
    {owner && group.memberIds.length < LISTENING_ROOM_CAPACITY && <form className="listening-invite" onSubmit={event => {
      event.preventDefault();
      if (peer) void change({ action: 'inviteRoom', peerId: Number(peer) });
    }}>
      <select aria-label="选择好友" value={peer} onChange={event => setPeer(event.target.value)} disabled={busy || !friends.length}>
        <option value="">{friends.length ? '选择好友' : '暂无可邀请好友'}</option>
        {friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
      </select>
      <button className="btn ghost sm" disabled={busy || !peer}>邀请</button>
      {!!group.pendingIds.length && <small className="sub">{group.pendingIds.length} 个待接受</small>}
    </form>}
  </section>;
}

const EMPTY_MESSAGES: NonNullable<NonNullable<ListeningRoom['group']>['messages']> = [];

export function ListeningRoomChat({ room, compact = false }: { room: ListeningRoom; compact?: boolean }) {
  const { me, toast } = useApp();
  const { action, state } = useSocial();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = room.group?.messages ?? EMPTY_MESSAGES;
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const node = list.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [lastId]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true);
    try { stick.current = true; await action({ action: 'roomMessage', roomId: room.id, text: draft.trim() }); setDraft(''); }
    catch (error) { toast(error instanceof Error ? error.message : '发送失败'); }
    finally { setBusy(false); }
  }
  return <section className={`social-chat listening-room-chat ${compact ? 'compact' : ''}`} aria-label="房间聊天">
    {!compact && <header><h2>房间聊天</h2></header>}
    <div className="social-messages" ref={list} role="log" onScroll={event => {
      const node = event.currentTarget;
      stick.current = node.scrollHeight - node.clientHeight - node.scrollTop < 70;
    }}>
      {!messages.length && <div className="center sub">暂无消息</div>}
      {messages.map(message => {
        const mine = message.senderId === me?.id;
        const name = state?.people.find(person => person.id === message.senderId)?.name ?? '成员';
        return <div key={message.id} className={`message-entry ${mine ? 'mine' : ''}`}>
          {!mine && <small className="message-meta">{name}</small>}
          <p className={`social-message ${mine ? 'mine' : ''}`}>{message.text}</p>
        </div>;
      })}
    </div>
    <form onSubmit={send}>
      <input aria-label="房间消息" placeholder="输入消息" maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} />
      <button className="ib" aria-label="发送房间消息" disabled={busy || !draft.trim()}><Icon n="send" s={16} /></button>
    </form>
  </section>;
}
