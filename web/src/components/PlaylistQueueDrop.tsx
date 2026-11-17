'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/app';
import type { CanvasSource } from '@/lib/canvas-types';
import { personalPlaylistSongs } from '@/lib/playlist-queue';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';

type Drag = { source: CanvasSource; pointer: number; x: number; y: number };
export function PlaylistQueueDrop() {
  const app = useApp(), path = usePathname();
  const current = useRef(app); current.current = app;
  const drag = useRef<Drag | null>(null), zone = useRef<HTMLDivElement>(null), pending = useRef(false);
  const [ghost, setGhost] = useState<Drag | null>(null);
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    const inside = (x: number, y: number) => {
      const bounds = zone.current?.getBoundingClientRect();
      return !!bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    };
    const cancel = () => { drag.current = null; setGhost(null); setOver(false); };
    cancel();
    const begin = (event: Event) => {
      const data = (event as CustomEvent<Drag>).detail;
      if (pending.current || data?.source?.kind !== 'playlist' || !data.source.playlistId) return;
      drag.current = data; setGhost(data);
    };
    const move = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointer) return;
      if (event.cancelable) event.preventDefault();
      drag.current = { ...drag.current, x: event.clientX, y: event.clientY };
      setGhost(drag.current); setOver(inside(event.clientX, event.clientY));
    };
    const finish = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      const accepted = event.type === 'pointerup' && inside(event.clientX, event.clientY);
      cancel(); if (!accepted) return;
      const userId = current.current.me?.id;
      pending.current = true; setBusy(true);
      void (async () => {
        try {
          const songs = await personalPlaylistSongs(active.source.playlistId!);
          if (!mounted || current.current.me?.id !== userId) return;
          await current.current.appendMany(songs);
          if (mounted) window.dispatchEvent(new Event('nt:canvas-open-queue'));
        } catch (error) { if (mounted) current.current.toast(error instanceof Error ? error.message : '添加歌单失败'); }
        finally { pending.current = false; if (mounted) setBusy(false); }
      })();
    };
    const touch = (event: TouchEvent) => { if (drag.current && event.cancelable) event.preventDefault(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('nt:queue-source', begin); window.addEventListener('blur', cancel);
    document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish);
    document.addEventListener('touchmove', touch, { passive: false }); document.addEventListener('keydown', key);
    return () => {
      mounted = false; drag.current = null;
      window.removeEventListener('nt:queue-source', begin); window.removeEventListener('blur', cancel);
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish);
      document.removeEventListener('touchmove', touch); document.removeEventListener('keydown', key);
    };
  }, [path]);
  if (!ghost && !busy) return null;
  return createPortal(<>
    {ghost && <div className="playlist-drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true"><Cover src={ghost.source.cover} seed={ghost.source.playlistId || 'playlist'} /><span><b>{ghost.source.name}</b><small>整张歌单</small></span></div>}
    <div ref={zone} className={`playlist-queue-drop ${over ? 'over' : ''}`} role="status">{busy ? <Loading inline label="正在添加歌单" /> : <Icon n="list" s={22} />}<span>{busy ? '正在添加歌单…' : over ? '松开，接到播放列表末尾' : '拖到这里，加入播放列表'}</span></div>
  </>, document.body);
}
