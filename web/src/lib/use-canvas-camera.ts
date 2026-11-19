'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { CANVAS_DRAG_THRESHOLD, fitCamera, worldPoint, zoomAt, type Camera } from './canvas-camera';

type Point = { x: number; y: number };
type Contact = Point & { panFrom?: Point };
type Surface = RefObject<HTMLDivElement | null>;
export function useCanvasCamera({ board, world, onFrame, user, onGesture, isDragging }: {
  board: Surface; world: Surface; onFrame: (view: Camera) => void; user: number | undefined;
  onGesture: () => void; isDragging: () => boolean;
}) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const live = useRef(camera);
  const frame = useRef<number | null>(null);
  const paintedZoom = useRef(1);
  const gesture = useRef(onGesture); gesture.current = onGesture;
  const pointers = useRef(new Map<number, Contact>());
  const pointerType = useRef('');
  const pan = useRef<number | null>(null), pinching = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const space = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [moving, setMoving] = useState(false);
  const key = `nt-canvas-camera-v2:${user ?? 'guest'}`;
  const paint = useCallback(() => {
    frame.current = null;
    const view = live.current;
    if (world.current) world.current.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;
    onFrame(view);
    if (paintedZoom.current !== view.zoom) {
      paintedZoom.current = view.zoom;
      setCamera(view);
    }
  }, [onFrame, world]);
  const commit = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    paint();
    setCamera(live.current);
  }, [paint]);
  const update = useCallback((value: Camera, settled = false) => {
    live.current = value;
    if (settled) commit();
    else if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [commit, paint]);
  const release = useCallback((pointerId: number) => {
    if (!pointers.current.delete(pointerId)) return false;
    const wasGesture = pinching.current || pan.current === pointerId;
    if (pinching.current && pointers.current.size === 1) {
      pinching.current = false;
      pan.current = pointers.current.keys().next().value!;
    } else if (!pointers.current.size && wasGesture) {
      pan.current = null;
      pinching.current = false;
      if (!wheelTimer.current) { commit(); setMoving(false); }
    }
    return wasGesture;
  }, [commit]);
  useEffect(() => {
    const el = board.current; if (!el) return;
    let saved: Camera | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= .2 && saved.zoom <= 2.5 && Math.abs(saved.x) < 3_000_000 && Math.abs(saved.y) < 3_000_000) update(saved, true);
    else {
      const zoom = Math.max(.65, fitCamera(el.clientWidth, el.clientHeight, []).zoom);
      update({ x: el.clientWidth / 2 - 500 * zoom, y: el.clientHeight / 2 - 325 * zoom, zoom }, true);
    }
    const resize = new ResizeObserver(entries => {
      // Keep the same world point at the viewport centre when the keyboard or window changes.
      const r = entries[0].contentRect;
      if (size.width && (size.width !== r.width || size.height !== r.height)) {
        update({ ...live.current, x: live.current.x + (r.width - size.width) / 2, y: live.current.y + (r.height - size.height) / 2 }, true);
      }
      size = { width: r.width, height: r.height };
    });
    let size = { width: el.clientWidth, height: el.clientHeight };
    resize.observe(el);
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('button:not(.nc-stencil-handle),input,textarea')) return;
      event.preventDefault();
      if (pointers.current.size && el.querySelector('[data-graffiti-draft]')) return;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      else setMoving(true);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        if (pan.current === null && !pinching.current) { commit(); setMoving(false); }
      }, 140);
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
    const releaseOutside = (event: PointerEvent) => { release(event.pointerId); };
    const blur = () => {
      spaceEnd();
      if (!pointers.current.size) return;
      pointers.current.clear();
      pan.current = null;
      pinching.current = false;
      commit();
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
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [board, commit, key, release, update]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(camera)); } catch {} }, 300); return () => clearTimeout(timer); }, [camera, key]);
  const point = useCallback((x: number, y: number) => { const rect = board.current!.getBoundingClientRect(); return worldPoint({ x: x - rect.left, y: y - rect.top }, live.current); }, [board]);
  const zoom = useCallback((factor: number) => { const el = board.current!; update(zoomAt(live.current, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, live.current.zoom * factor), true); }, [board, update]);
  const fit = useCallback((items: Point[]) => { const el = board.current!; update(fitCamera(el.clientWidth, el.clientHeight, items), true); }, [board, update]);
  const handlers = {
    onPointerDownCapture(event: React.PointerEvent) {
      if (event.button !== 0 && event.button !== 1) return;
      const draft = event.currentTarget.querySelector('[data-graffiti-draft]');
      const target = event.target as HTMLElement;
      if (target.closest('button:not(.nc-stencil-handle),input,textarea')) return;
      const temporaryPan = event.button === 1 || (draft && space.current);
      if (pointers.current.size && pointerType.current !== event.pointerType) return;
      if (pointers.current.size >= 2) { event.stopPropagation(); return; }
      pointerType.current = event.pointerType;
      const blank = !target.closest('[data-canvas-item]');
      const at = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, { ...at, panFrom: event.pointerType === 'touch' && !draft && !blank ? at : undefined });
      if (pointers.current.size === 2) {
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
      if (pinching.current && pointers.current.size === 2) {
        const old = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = [...pointers.current.values()], rect = event.currentTarget.getBoundingClientRect();
        const mid = (a: typeof old) => ({ x: (a[0].x + a[1].x) / 2 - rect.left, y: (a[0].y + a[1].y) / 2 - rect.top });
        const distance = (a: typeof old) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const a = mid(old), b = mid(next), z = zoomAt(live.current, a, live.current.zoom * distance(next) / Math.max(1, distance(old)));
        update({ ...z, x: z.x + b.x - a.x, y: z.y + b.y - a.y }); event.stopPropagation(); event.preventDefault();
        return;
      }
      const next = { x: event.clientX, y: event.clientY };
      let from = previous;
      if (pan.current === null && previous.panFrom && !isDragging()
        && Math.hypot(next.x - previous.panFrom.x, next.y - previous.panFrom.y) > CANVAS_DRAG_THRESHOLD) {
        from = previous.panFrom;
        gesture.current();
        pan.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setMoving(true);
      }
      pointers.current.set(event.pointerId, { ...next, panFrom: pan.current === event.pointerId ? undefined : previous.panFrom });
      if (pan.current === event.pointerId) {
        update({ ...live.current, x: live.current.x + next.x - from.x, y: live.current.y + next.y - from.y });
        event.stopPropagation();
        event.preventDefault();
      }
    },
    onPointerUpCapture(event: React.PointerEvent) {
      if (release(event.pointerId)) event.stopPropagation();
    },
    onPointerCancelCapture(event: React.PointerEvent) {
      if (!pointers.current.has(event.pointerId)) return;
      release(event.pointerId);
      gesture.current();
    },
    onLostPointerCapture(event: React.PointerEvent) {
      if (event.target === event.currentTarget) release(event.pointerId);
    },
  };
  return { camera, moving, spaceDown, point, zoom, fit, handlers };
}
