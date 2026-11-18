'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fitCamera, worldPoint, zoomAt, type Camera } from './canvas-camera';

export function useCanvasCamera(board: RefObject<HTMLDivElement | null>, user: number | undefined, onGesture: () => void) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const live = useRef(camera); live.current = camera;
  const gesture = useRef(onGesture); gesture.current = onGesture;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pointerType = useRef('');
  const pan = useRef<number | null>(null), pinching = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const space = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [moving, setMoving] = useState(false);
  const key = `nt-canvas-camera-v2:${user ?? 'guest'}`;
  const update = useCallback((value: Camera) => { live.current = value; setCamera(value); }, []);
  useEffect(() => {
    const el = board.current; if (!el) return;
    let saved: Camera | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= .2 && saved.zoom <= 2.5 && Math.abs(saved.x) < 3_000_000 && Math.abs(saved.y) < 3_000_000) update(saved);
    else {
      const zoom = Math.max(.65, fitCamera(el.clientWidth, el.clientHeight, []).zoom);
      update({ x: el.clientWidth / 2 - 500 * zoom, y: el.clientHeight / 2 - 325 * zoom, zoom });
    }
    const resize = new ResizeObserver(entries => {
      // Keep the same world point at the viewport centre when the keyboard or window changes.
      const r = entries[0].contentRect;
      if (size.width) update({ ...live.current, x: live.current.x + (r.width - size.width) / 2, y: live.current.y + (r.height - size.height) / 2 });
      size = { width: r.width, height: r.height };
    });
    let size = { width: el.clientWidth, height: el.clientHeight };
    resize.observe(el);
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('button:not(.nc-stencil-handle),input,textarea')) return;
      event.preventDefault();
      if (el.querySelector('[data-graffiti-draft]')) {
        if (pointers.current.size) return;
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        setMoving(true);
        wheelTimer.current = setTimeout(() => {
          wheelTimer.current = null;
          if (pan.current === null && !pinching.current) setMoving(false);
        }, 140);
      }
      const rect = el.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) update(zoomAt(live.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, live.current.zoom * Math.exp(-event.deltaY * .007)));
      else update({ ...live.current, x: live.current.x - event.deltaX, y: live.current.y - event.deltaY });
    };
    const spaceStart = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
        || (event.target as Element | null)?.closest?.('input,textarea,select,button:focus-visible,a:focus-visible,[contenteditable=true]')
        || !el.querySelector('[data-graffiti-draft]')) return;
      event.preventDefault();
      space.current = true;
      setSpaceDown(true);
    };
    const spaceEnd = () => { space.current = false; setSpaceDown(false); };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spaceEnd(); };
    const releaseOutside = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId)) return;
      if (pan.current === event.pointerId) pan.current = null;
      if (!pointers.current.size) { pinching.current = false; setMoving(!!wheelTimer.current); }
    };
    const blur = () => {
      spaceEnd();
      if (!pointers.current.size) return;
      pointers.current.clear();
      pan.current = null;
      pinching.current = false;
      setMoving(!!wheelTimer.current);
      gesture.current();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('keydown', spaceStart);
    document.addEventListener('keyup', keyUp);
    window.addEventListener('pointerup', releaseOutside);
    window.addEventListener('pointercancel', releaseOutside);
    window.addEventListener('blur', blur);
    return () => {
      resize.disconnect();
      el.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', spaceStart);
      document.removeEventListener('keyup', keyUp);
      window.removeEventListener('pointerup', releaseOutside);
      window.removeEventListener('pointercancel', releaseOutside);
      window.removeEventListener('blur', blur);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    };
  }, [board, key, update]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(camera)); } catch {} }, 300); return () => clearTimeout(timer); }, [camera, key]);
  const point = useCallback((x: number, y: number) => { const rect = board.current!.getBoundingClientRect(); return worldPoint({ x: x - rect.left, y: y - rect.top }, live.current); }, [board]);
  const zoom = useCallback((factor: number) => { const el = board.current!; update(zoomAt(live.current, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, live.current.zoom * factor)); }, [board, update]);
  const fit = useCallback((items: { x: number; y: number }[]) => { const el = board.current!; update(fitCamera(el.clientWidth, el.clientHeight, items)); }, [board, update]);
  const handlers = {
    onPointerDownCapture(event: React.PointerEvent) {
      if (event.button !== 0 && event.button !== 1) return;
      const draft = event.currentTarget.querySelector('[data-graffiti-draft]');
      const target = event.target as HTMLElement;
      if (target.closest('button:not(.nc-stencil-handle),input,textarea')) return;
      const temporaryPan = event.button === 1 || (draft && space.current);
      if (pointers.current.size && pointerType.current !== event.pointerType) return;
      pointerType.current = event.pointerType;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const blank = !target.closest('[data-canvas-item]');
      if (pointers.current.size >= 2) {
        gesture.current();
        pinching.current = true;
        pan.current = null;
        setMoving(true);
        for (const id of pointers.current.keys()) event.currentTarget.setPointerCapture(id);
        event.stopPropagation();
      } else if (temporaryPan || (draft ? draft.hasAttribute('data-hand') : blank)) {
        pan.current = event.pointerId;
        setMoving(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (temporaryPan) event.preventDefault();
        event.stopPropagation();
      }
    },
    onPointerMoveCapture(event: React.PointerEvent) {
      const previous = pointers.current.get(event.pointerId); if (!previous) return;
      if (pinching.current && pointers.current.size >= 2) {
        const old = [...pointers.current.values()].slice(0, 2);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = [...pointers.current.values()].slice(0, 2), rect = board.current!.getBoundingClientRect();
        const mid = (a: typeof old) => ({ x: (a[0].x + a[1].x) / 2 - rect.left, y: (a[0].y + a[1].y) / 2 - rect.top });
        const distance = (a: typeof old) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const a = mid(old), b = mid(next), z = zoomAt(live.current, a, live.current.zoom * distance(next) / Math.max(1, distance(old)));
        update({ ...z, x: z.x + b.x - a.x, y: z.y + b.y - a.y }); event.stopPropagation(); event.preventDefault();
      } else {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pan.current === event.pointerId) { update({ ...live.current, x: live.current.x + event.clientX - previous.x, y: live.current.y + event.clientY - previous.y }); event.stopPropagation(); event.preventDefault(); }
      }
    },
    onPointerUpCapture(event: React.PointerEvent) {
      const wasGesture = pinching.current || pan.current === event.pointerId;
      pointers.current.delete(event.pointerId); if (pan.current === event.pointerId) pan.current = null;
      if (!pointers.current.size) { pinching.current = false; setMoving(!!wheelTimer.current); }
      if (wasGesture) event.stopPropagation();
    },
    onPointerCancelCapture(event: React.PointerEvent) {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.delete(event.pointerId);
      if (pan.current === event.pointerId) pan.current = null;
      if (!pointers.current.size) { pinching.current = false; setMoving(!!wheelTimer.current); }
      gesture.current();
    },
  };
  return { camera, moving, spaceDown, point, zoom, fit, handlers };
}
