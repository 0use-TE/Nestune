'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import type { ConversationHistory, Message, Person } from '@/lib/social-types';
import type { Song } from '@/lib/types';
import { ChatSongPicker } from './ChatSongPicker';
import { Avatar, Cover } from './Cover';
import { Icon } from './Icon';

export function Conversation({ person, userId, onClose, canInvite, onInvite, compact = false, visible = true }: {
  person: Person; userId: number; onClose?: () => void; canInvite?: boolean; onInvite?: () => void; compact?: boolean; visible?: boolean;
}) {
  const { action } = useSocial();
  const app = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [peerReadThrough, setPeerReadThrough] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickingSong, setPickingSong] = useState(false);
  const [loadingSong, setLoadingSong] = useState<string | null>(null);
  const [hasEarlier, setHasEarlier] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const followBottom = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const lastMarked = useRef(0);
  const inView = useRef(false);
  const path = `/api/social?peer=${person.id}`;
  const inbound = messages.findLast(message => message.senderId === person.id)?.id ?? 0;
  const markVisible = useCallback(() => {
    if (!visible || !inView.current || !followBottom.current || document.visibilityState !== 'visible' || inbound <= lastMarked.current) return;
    lastMarked.current = inbound;
    action({ action: 'read', peerId: person.id, throughId: inbound }).catch(() => {
      if (lastMarked.current === inbound) lastMarked.current = 0;
    });
  }, [action, inbound, person.id, visible]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const data = await get<ConversationHistory>(path);
        if (!live) return;
        setMessages(current => mergeMessages(current, data.messages));
        setPeerReadThrough(data.peerReadThrough ?? 0);
        setReady(true);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : '无法读取消息');
      } finally { if (live) timer = setTimeout(read, 2200); }
    }
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [path, visible]);

  useEffect(() => {
    const node = list.current;
    if (!visible || !node) return;
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      markVisible();
    });
    observer.observe(node);
    document.addEventListener('visibilitychange', markVisible);
    return () => { inView.current = false; observer.disconnect(); document.removeEventListener('visibilitychange', markVisible); };
  }, [markVisible, visible]);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (prepend.current) {
      node.scrollTop = prepend.current.top + node.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (followBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!pickingSong) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !composer.current?.contains(event.target)) setPickingSong(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [pickingSong]);

  async function earlier() {
    setBusy(true);
    try {
      const data = await get<{ messages: Message[] }>(`${path}&before=${messages[0].id}`);
      if (list.current && data.messages.length) prepend.current = { height: list.current.scrollHeight, top: list.current.scrollTop };
      setMessages(current => mergeMessages(current, data.messages));
      setHasEarlier(data.messages.length === 50);
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取消息'); }
    finally { setBusy(false); }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    await sendMessage({ action: 'message', text: draft });
  }

  function closeSongPicker() {
    setPickingSong(false);
    shareButton.current?.focus();
  }

  async function sendMessage(payload: { action: 'message'; text: string } | { action: 'shareSong'; songId: string }) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { message } = await post<{ message: Message }>('/api/social', { ...payload, peerId: person.id });
      followBottom.current = true;
      setMessages(current => mergeMessages(current, [message]));
      if (payload.action === 'message') setDraft(current => current === payload.text ? '' : current);
      else if (composer.current?.contains(document.activeElement)) closeSongPicker();
      else setPickingSong(false);
    } catch (e) { setError(e instanceof Error ? e.message : '发送失败'); }
    finally { setBusy(false); }
  }

  async function playSong(id: string) {
    if (loadingSong) return;
    setLoadingSong(id);
    try {
      const { song } = await get<{ song: Song }>(`/api/songs/${id}`);
      app.play([song]);
    } catch (e) { app.toast(e instanceof Error ? e.message : '无法播放歌曲'); }
    finally { setLoadingSong(null); }
  }

  return (
    <section className={`social-chat ${compact ? 'compact' : ''}`} aria-label={`与 ${person.name} 聊天`}>
      {!compact && (
        <header>
          <div className="chat-contact">
            {onClose && <button className="ib chat-back" aria-label="返回聊天列表" onClick={onClose}><Icon n="back" /></button>}
            <Avatar src={person.avatar} name={person.name} /><h2 className="t1">{person.name}</h2>
          </div>
          <div className="row">
            {onInvite && <button className="btn ghost sm" disabled={!canInvite} onClick={onInvite}>邀请一起听</button>}
            {onClose && <button className="ib chat-close" aria-label="关闭聊天" onClick={onClose}><Icon n="x" /></button>}
          </div>
        </header>
      )}
      <div ref={list} className="social-messages" onScroll={e => {
        const node = e.currentTarget;
        followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 70;
        markVisible();
      }}>
        {!ready && !error && <div className="center sub">加载中…</div>}
        {ready && !messages.length && <div className="center sub">暂无消息</div>}
        {hasEarlier && messages.length >= 50 && <button className="link social-earlier" disabled={busy} onClick={earlier}>更早的消息</button>}
        {messages.map(message => (
          <div className={`message-entry ${message.senderId === userId ? 'mine' : ''}`} key={message.id}>
            {message.song ? (
              <button type="button" className="chat-song-card chat-song-row" aria-label={`播放 ${message.song.name}`}
                disabled={loadingSong !== null} onClick={() => playSong(message.song!.id)}>
                <Cover src={message.song.cover} seed={message.song.id} />
                <span className="chat-song-text"><b className="t1">{message.song.name}</b><small className="t1">{message.song.artist}</small></span>
                <Icon n="play" s={16} />
              </button>
            ) : <p className={`social-message ${message.senderId === userId ? 'mine' : ''}`}>{message.text}</p>}
            <small className="message-meta" title={new Date(message.sentAt).toLocaleString()}>{messageAge(message.sentAt)}{message.senderId === userId && ` · ${message.id <= peerReadThrough ? '已读' : '未读'}`}</small>
          </div>
        ))}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="chat-composer" ref={composer} onKeyDown={event => {
        if (event.key !== 'Escape' || !pickingSong) return;
        event.preventDefault();
        closeSongPicker();
      }}>
        {pickingSong && <ChatSongPicker current={app.current} busy={busy} onClose={closeSongPicker} onShare={songId => sendMessage({ action: 'shareSong', songId })} />}
        <form onSubmit={send}>
          <button ref={shareButton} type="button" className={`ib chat-share ${pickingSong ? 'act' : ''}`} aria-label="分享歌曲"
            title="分享歌曲" aria-expanded={pickingSong} onClick={() => setPickingSong(open => !open)}><Icon n="note" s={18} /></button>
          <input aria-label="消息" placeholder="输入消息" maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} />
          {compact ? <button className="ib compact-send" aria-label="发送" title="发送" disabled={busy || !draft.trim()}><Icon n="send" s={16} /></button>
            : <button className="btn sm" disabled={busy || !draft.trim()}>发送</button>}
        </form>
      </div>
    </section>
  );
}

export function messageAge(sentAt: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - sentAt) / 60_000));
  if (!minutes) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const known = new Map(current.map(message => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const previous = known.get(message.id);
    if (!previous || previous.text !== message.text || previous.song?.id !== message.song?.id) {
      known.set(message.id, message);
      changed = true;
    }
  }
  return changed ? [...known.values()].sort((a, b) => a.id - b.id) : current;
}

