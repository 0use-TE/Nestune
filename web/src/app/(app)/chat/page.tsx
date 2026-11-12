'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar } from '@/components/Cover';
import { Conversation, messageAge } from '@/components/Conversation';
import { Icon } from '@/components/Icon';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';

export default function ChatPage() {
  return <Suspense fallback={<div className="center sub">加载聊天…</div>}><Chats /></Suspense>;
}

function Chats() {
  const params = useSearchParams();
  const requested = params.get('peer');
  const listOnly = params.get('list') === '1';
  const userId = useApp().me!.id;
  return <ChatView key={JSON.stringify([userId, requested, listOnly])} userId={userId}
    initialPeer={Number(requested) || null} restore={requested === null && !listOnly} />;
}

function ChatView({ userId, initialPeer, restore }: { userId: number; initialPeer: number | null; restore: boolean }) {
  const app = useApp();
  const router = useRouter();
  const { state, error } = useSocial();
  const [rememberedPeer, setRememberedPeer] = useState<number | null>(null);
  const storageKey = `nt-chat-peer:${userId}`;
  const summaries = new Map(state?.inbox?.map(item => [item.peerId, item]));
  const friends = (state?.people ?? []).filter(person => person.friendship === 'friend').sort((a, b) =>
    (summaries.get(b.id)?.latest.id ?? 0) - (summaries.get(a.id)?.latest.id ?? 0));
  const peer = friends.find(person => person.id === (initialPeer ?? rememberedPeer));
  const peerId = peer?.id;

  useEffect(() => {
    if (!restore) return;
    try { setRememberedPeer(Number(localStorage.getItem(storageKey)) || null); } catch { /* Storage may be unavailable. */ }
  }, [restore, storageKey]);

  useEffect(() => {
    if (!peerId) return;
    try { localStorage.setItem(storageKey, String(peerId)); } catch { /* Storage may be unavailable. */ }
  }, [peerId, storageKey]);

  return (
    <div className="chat-page">
      <h1>聊天</h1>
      {error && <p className="note" role="status">{error}</p>}
      <div className={`chat-layout ${peer ? 'has-thread' : ''}`}>
        <section className="chat-list" aria-label="聊天列表">
          {!state && !error && <div className="center sub">加载聊天…</div>}
          {state && !friends.length && <div className="center sub">在「一起听」添加好友后即可聊天</div>}
          {friends.map(person => {
            const summary = summaries.get(person.id);
            const sent = summary?.latest.senderId === userId;
            return (
              <Link key={person.id} href={`/chat?peer=${person.id}`} prefetch={false} className={`chat-thread ${peer?.id === person.id ? 'on' : ''}`} aria-current={peer?.id === person.id ? 'true' : undefined}>
                <Avatar src={person.avatar} name={person.name} />
                <span className="chat-thread-info">
                  <span className="chat-thread-title"><b className="t1">{person.name}</b>{summary && <time dateTime={new Date(summary.latest.sentAt).toISOString()}>{messageAge(summary.latest.sentAt)}</time>}</span>
                  <span className="chat-thread-preview"><span className="t1">{summary ? (sent ? '你：' : '') + summary.latest.text : '暂无消息'}</span>
                    {summary?.unread ? <span className="unread-count" aria-label={`${summary.unread} 条未读`}>{summary.unread > 99 ? '99+' : summary.unread}</span> : summary && <small>{sent && summary.latest.id > summary.peerReadThrough ? '未读' : '已读'}</small>}
                  </span>
                </span>
              </Link>
            );
          })}
        </section>
        {peer ? <Conversation key={peer.id} person={peer} userId={userId} visible={!app.nowOpen} onClose={() => router.replace('/chat?list=1')} /> : (
          <div className="chat-placeholder"><Icon n="lyrics" s={30} /><span>选择一个聊天</span></div>
        )}
      </div>
    </div>
  );
}
