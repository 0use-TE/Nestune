'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/app';
import { useOptionalSocial } from '@/lib/social';
import { post } from '@/lib/api';
import { isDeviceSong } from '@/lib/device-music';
import type { CanvasSource } from '@/lib/canvas-types';
import type { Message } from '@/lib/social-types';
import { Avatar, Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';

type Drag = { source: CanvasSource; pointer: number; x: number; y: number };
export function FriendSongDrop() {
  const app = useApp(), social = useOptionalSocial(), path = usePathname();
  const latest = useRef({ app, social }); latest.current = { app, social };
  const active = useRef<Drag | null>(null), pending = useRef(false);
  const [ghost, setGhost] = useState<Drag | null>(null), [over, setOver] = useState<number | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  useEffect(() => {
    if (path !== '/social') return;
    setSending(null);
    let mounted = true;
    const recipient = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-song-recipient]');
      const id = Number(target?.dataset.songRecipient);
      if (latest.current.social?.state?.people.some(person => person.id === id && person.friendship === 'friend')) return id;
      return null;
    };
    const clear = (success = false, peerId?: number) => {
      active.current = null; setGhost(null); setOver(null);
      delete document.body.dataset.friendSongDrag;
      document.querySelectorAll('[data-song-drop-over]').forEach(node => node.removeAttribute('data-song-drop-over'));
      window.dispatchEvent(new CustomEvent('nt:friend-song-finish', { detail: { success, peerId } }));
    };
    const highlight = (id: number | null) => {
      document.querySelectorAll<HTMLElement>('[data-song-recipient]').forEach(node => {
        if (id && Number(node.dataset.songRecipient) === id) node.dataset.songDropOver = '';
        else delete node.dataset.songDropOver;
      });
      setOver(id);
    };
    const begin = (event: Event) => {
      const drag = (event as CustomEvent<Drag>).detail;
      if (pending.current || !drag?.source?.songId || drag.source.kind !== 'song' || isDeviceSong(drag.source.songId)) return;
      active.current = drag; document.body.dataset.friendSongDrag = ''; setGhost(drag); highlight(recipient(drag.x, drag.y));
    };
    const move = (event: PointerEvent) => {
      if (!active.current || event.pointerId !== active.current.pointer) return;
      if (event.cancelable) event.preventDefault();
      active.current = { ...active.current, x: event.clientX, y: event.clientY };
      setGhost(active.current); highlight(recipient(event.clientX, event.clientY));
    };
    const finish = (event: PointerEvent) => {
      const drag = active.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      const peerId = event.type === 'pointerup' ? recipient(event.clientX, event.clientY) : null;
      if (!peerId || pending.current) { clear(); return; }
      const userId = latest.current.app.me?.id;
      const person = latest.current.social?.state?.people.find(person => person.id === peerId);
      pending.current = true; setSending(person?.name || '好友'); clear(true, peerId);
      void (async () => {
        try {
          if (!userId || latest.current.app.me?.id !== userId) return;
          const { message } = await post<{ message: Message }>('/api/social', { action: 'shareSong', peerId, songId: drag.source.songId });
          if (!mounted || latest.current.app.me?.id !== userId) return;
          window.dispatchEvent(new CustomEvent('nt:friend-song-sent', { detail: { peerId, message } }));
          window.dispatchEvent(new Event('nt:social-refresh'));
          latest.current.app.toast(`已发送给 ${person?.name || '好友'}`);
        } catch (error) { if (mounted) latest.current.app.toast(error instanceof Error ? error.message : '发送歌曲失败，请重试'); }
        finally { pending.current = false; if (mounted) setSending(null); }
      })();
    };
    const cancel = () => { if (active.current) clear(); };
    const touch = (event: TouchEvent) => { if (active.current && event.cancelable) event.preventDefault(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('nt:friend-song-source', begin); window.addEventListener('blur', cancel);
    document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish);
    document.addEventListener('touchmove', touch, { passive: false }); document.addEventListener('keydown', key, true);
    return () => { mounted = false; cancel(); window.removeEventListener('nt:friend-song-source', begin); window.removeEventListener('blur', cancel); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); document.removeEventListener('touchmove', touch); document.removeEventListener('keydown', key, true); };
  }, [path]);
  if (path !== '/social' || !ghost && !sending) return null;
  const person = social?.state?.people.find(person => person.id === over);
  return createPortal(<div className="friend-song-drag" aria-live="polite">
    {ghost && <div className="friend-song-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true"><Cover src={ghost.source.cover} seed={ghost.source.songId!} /><span><b className="t1">{ghost.source.name}</b><small>{person ? `发给 ${person.name}` : '拖到好友或聊天区域'}</small></span></div>}
    <div className={`friend-song-drop-hint ${person ? 'over' : ''}`} role="status">{sending ? <Loading inline label="正在发送歌曲" /> : person ? <Avatar src={person.avatar} name={person.name} /> : <Icon n="send" s={23} />}<span>{sending ? `正在发送给 ${sending}…` : person ? `松开，发送给 ${person.name}` : '拖到好友头像或聊天区域，松开发送'}</span></div>
  </div>, document.body);
}
