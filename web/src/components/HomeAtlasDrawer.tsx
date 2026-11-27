'use client';
import { prefersQuietTransitions } from '@/lib/interface-motion';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { registerOverlay } from '@/lib/overlays';
import styles from './taste-atlas.module.css';

const PULL_THRESHOLD = 84;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function HomeAtlasDrawer({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const progress = useRef(0);
  const destination = useRef(false);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const paint = useCallback((value: number) => {
    progress.current = clamp(value);
    root.current?.style.setProperty('--atlas-progress', String(progress.current));
  }, []);

  const settle = useCallback((next: boolean) => {
    cancelAnimationFrame(frame.current);
    destination.current = next;
    setOpen(next);
    const from = progress.current, end = Number(next);
    const reduced = prefersQuietTransitions();
    const duration = reduced ? 190 : 260 + 440 * Math.abs(end - from);
    const start = performance.now();
    function tick(now: number) {
      const t = clamp((now - start) / duration);
      // Smooth acceleration is visible even when a wheel emits one large notch.
      const eased = t * t * (3 - 2 * t);
      paint(from + (end - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    }
    frame.current = requestAnimationFrame(tick);
  }, [paint]);

  useEffect(() => {
    if (open) return registerOverlay(() => { settle(false); handle.current?.focus(); }, 'page');
  }, [open, settle]);

  useEffect(() => {
    const surface = root.current?.closest('main');
    if (!surface) return;
    let start: { x: number; y: number; from: number; height: number; wasOpen: boolean } | null = null;
    let dragged = false;
    let distance = 0;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;
    let wheeling = false;
    function begin(target: EventTarget | null, x: number, y: number) {
      if (!(target instanceof Element)) return;
      const onHandle = !!handle.current?.contains(target);
      if (!onHandle && (destination.current || surface!.scrollTop > 1 ||
        target.closest('a,button,input,textarea,select,[role=button],[data-canvas-source],.tr'))) return;
      start = { x, y, from: progress.current, height: panel.current?.offsetHeight || 600, wasOpen: destination.current };
      dragged = false;
      distance = 0;
      suppressClick.current = false;
    }
    function drag(x: number, y: number) {
      if (!start) return false;
      const dy = y - start.y;
      if (!dragged && Math.abs(dy) < 5) return false;
      if (!dragged && (Math.abs(x - start.x) > Math.abs(dy) || (start.wasOpen ? dy > 0 : dy < 0))) {
        start = null;
        return false;
      }
      cancelAnimationFrame(frame.current);
      distance = dy;
      dragged = true;
      paint(start.from + dy / start.height);
      return true;
    }
    function finish(cancelled = false) {
      if (start && dragged) {
        suppressClick.current = true;
        settle(!cancelled && Math.abs(distance) >= PULL_THRESHOLD ? !start.wasOpen : start.wasOpen);
      }
      start = null;
      dragged = false;
    }
    const mouseDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 0) begin(e.target, e.clientX, e.clientY);
    };
    const mouseMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && start && drag(e.clientX, e.clientY)) e.preventDefault();
    };
    const mouseUp = (e: PointerEvent) => { if (e.pointerType === 'mouse') finish(); };
    const cancel = () => finish(true);
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) begin(e.target, e.touches[0].clientX, e.touches[0].clientY);
      else finish(true);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && drag(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    const touchEnd = () => finish();
    function wheel(e: WheelEvent) {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || start) return;
      const closing = destination.current;
      if (closing ? !handle.current?.contains(e.target as Node) || e.deltaY <= 0 : surface!.scrollTop > 1 || e.deltaY >= 0) return;
      e.preventDefault();
      if (!wheeling) { distance = 0; wheeling = true; }
      cancelAnimationFrame(frame.current);
      const pixels = -e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? surface!.clientHeight : 1);
      distance += pixels;
      paint(progress.current + Math.sign(pixels) * Math.min(48, Math.abs(pixels)) / (panel.current?.offsetHeight || 600));
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        wheeling = false;
        settle(Math.abs(distance) >= PULL_THRESHOLD ? !closing : closing);
      }, 90);
    }
    surface.addEventListener('pointerdown', mouseDown);
    window.addEventListener('pointermove', mouseMove);
    window.addEventListener('pointerup', mouseUp);
    window.addEventListener('blur', cancel);
    surface.addEventListener('touchstart', touchStart, { passive: true });
    surface.addEventListener('touchmove', touchMove, { passive: false });
    surface.addEventListener('touchend', touchEnd);
    surface.addEventListener('touchcancel', cancel);
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame.current); clearTimeout(wheelEnd);
      surface.removeEventListener('pointerdown', mouseDown);
      window.removeEventListener('pointermove', mouseMove);
      window.removeEventListener('pointerup', mouseUp);
      window.removeEventListener('blur', cancel);
      surface.removeEventListener('touchstart', touchStart);
      surface.removeEventListener('touchmove', touchMove);
      surface.removeEventListener('touchend', touchEnd);
      surface.removeEventListener('touchcancel', cancel);
      surface.removeEventListener('wheel', wheel);
    };
  }, [paint, settle]);

  return <div ref={root} className={styles.drawer} onKeyDown={e => {
    if (e.key === 'Escape' && open) { settle(false); handle.current?.focus(); }
  }}>
    <button ref={handle} className={styles.handle} data-atlas-handle type="button" aria-expanded={open} aria-controls={panelId}
      aria-label={open ? '收起音乐星图' : '下拉探索音乐星图'}
      onClick={e => {
        if (e.detail && suppressClick.current) { suppressClick.current = false; return; }
        settle(!destination.current);
      }}><i aria-hidden="true" /></button>
    <div id={panelId} className={styles.reveal} inert={!open} aria-hidden={!open}>
      <div ref={panel} className={styles.panel}>{children}</div>
    </div>
  </div>;
}
