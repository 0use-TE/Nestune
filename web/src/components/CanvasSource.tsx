'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { CanvasSource as Source } from '@/lib/canvas-types';

/** Consistent pointer dragging, including buttons in the playback queue and touch holds. */
export function CanvasSource({ source, children, className = '', queue = false }: { source: Source; children: React.ReactNode; className?: string; queue?: boolean }) {
  const canvas = usePathname() === '/square';
  const enabled = canvas || queue;
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number; pointer: number; element: HTMLElement; mouse: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current); }, []);
  const clear = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const start = (x?: number, y?: number) => {
    const from = origin.current; if (!from) return; clear(); suppressClick.current = true;
    try { from.element.setPointerCapture(from.pointer); } catch {}
    window.dispatchEvent(new CustomEvent(canvas ? 'nt:canvas-source' : 'nt:queue-source', { detail: { source, pointer: from.pointer, x: x ?? from.x, y: y ?? from.y } }));
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const from = origin.current;
      if (!hold.current || !from || event.pointerId !== from.pointer) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) { if (from.mouse) start(event.clientX, event.clientY); else clear(); }
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', clear); document.addEventListener('pointercancel', clear);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', clear); document.removeEventListener('pointercancel', clear); };
  }, [source, canvas]);
  return <div className={`canvas-source ${className}`} draggable={enabled} data-canvas-source={source.kind}
    onDragStart={event => {
      if (enabled) event.preventDefault();
    }}
    onDragEnd={() => window.dispatchEvent(new CustomEvent('nt:canvas-native', { detail: null }))}
    onContextMenu={event => { if (enabled) event.preventDefault(); }}
    onPointerDown={event => {
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('.queue-remove,[data-no-music-drag]')) return;
      clear(); origin.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId, element: event.currentTarget, mouse: event.pointerType === 'mouse' };
      if (event.pointerType === 'mouse') event.preventDefault();
      hold.current = setTimeout(() => start(), 360);
    }}
    onPointerMove={event => { if (hold.current && origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) { if (origin.current.mouse) start(event.clientX, event.clientY); else clear(); } }}
    onPointerUp={clear} onPointerCancel={clear}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
    {children}
  </div>;
}
