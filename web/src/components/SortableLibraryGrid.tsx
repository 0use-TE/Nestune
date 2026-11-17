'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  order: string[];
  disabled: boolean;
  onReorder: (next: string[]) => void;
  name: (key: string) => string;
  children: (key: string) => ReactNode;
};
type Session = {
  key: string; mode: 'pointer' | 'touch' | 'keyboard'; id: number; active: boolean;
  x: number; y: number; startX: number; startY: number; original: string[]; order: string[];
  ghost?: HTMLElement;
};

/** Touch scrolling stays native until the hold completes; only the drop is saved. */
export function SortableLibraryGrid({ order, disabled, onReorder, name, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const blockedClick = useRef(0);
  const positions = useRef(new Map<string, DOMRect>());
  const animations = useRef(new Map<HTMLElement, Animation>());
  const [draft, setDraft] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<{ key: string; keyboard: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const hint = useId();
  const currentOrder = draft ?? order;
  const latest = useRef({ order, disabled, onReorder, name });
  latest.current = { order, disabled, onReorder, name };

  function remember() {
    positions.current = new Map(Array.from(root.current?.children ?? []).map(node => [
      (node as HTMLElement).dataset.libraryCard!, node.getBoundingClientRect(),
    ]));
  }
  function exchange(current: Session, target: string) {
    const from = current.order.indexOf(current.key), to = current.order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...current.order];
    [next[from], next[to]] = [next[to], next[from]];
    remember(); current.order = next; setDraft(next);
    setAnnouncement(`${latest.current.name(current.key)}，第 ${to + 1} 项，共 ${next.length} 项`);
  }
  function tick() {
    const current = session.current;
    if (!current?.active || current.mode === 'keyboard') return;
    if (current.ghost) current.ghost.style.transform = `translate3d(${current.x - current.startX}px,${current.y - current.startY}px,0) scale(1.025)`;
    const main = document.getElementById('main');
    const scrollBounds = main?.getBoundingClientRect();
    if (main && scrollBounds && current.x >= scrollBounds.left && current.x <= scrollBounds.right) {
      const edge = Math.min(64, scrollBounds.height / 4);
      const amount = current.y < scrollBounds.top + edge ? -Math.min(14, (scrollBounds.top + edge - current.y) / 4)
        : current.y > scrollBounds.bottom - edge ? Math.min(14, (current.y - scrollBounds.bottom + edge) / 4) : 0;
      if (amount) main.scrollTop += amount;
    }
    const grid = root.current;
    if (grid) {
      const bounds = grid.getBoundingClientRect();
      for (const node of Array.from(grid.children) as HTMLElement[]) {
        if (node.dataset.libraryCard === current.key) continue;
        // Offset geometry is unaffected by the in-flight swap animations.
        const x = bounds.left + node.offsetLeft, y = bounds.top + node.offsetTop;
        if (current.x > x + 6 && current.x < x + node.offsetWidth - 6 && current.y > y + 6 && current.y < y + node.offsetHeight - 6) {
          exchange(current, node.dataset.libraryCard!); break;
        }
      }
    }
    frame.current = requestAnimationFrame(tick);
  }
  function finish(commit: boolean) {
    clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    const current = session.current;
    if (!current) return;
    session.current = null;
    current.ghost?.remove();
    document.body.classList.remove('is-sorting-library');
    setPicked(null);
    if (!current.active) return;
    blockedClick.current = Date.now() + 450;
    remember();
    if (commit && current.order.some((key, index) => key !== current.original[index])) {
      setDraft(current.order);
      latest.current.onReorder(current.order);
      setAnnouncement('排序已调整');
    } else {
      setDraft(null);
      setAnnouncement(commit ? '排序结束' : '已取消排序');
    }
  }
  function begin(element: HTMLElement, key: string, mode: Session['mode'], id: number, x: number, y: number) {
    if (session.current || latest.current.disabled) return;
    const bounds = element.getBoundingClientRect();
    const initial = [...latest.current.order];
    const current: Session = { key, mode, id, active: false, x, y, startX: x, startY: y, original: initial, order: initial };
    session.current = current;
    const activate = () => {
      if (session.current !== current) return;
      current.active = true;
      if (mode !== 'keyboard') {
        const ghost = element.cloneNode(true) as HTMLElement;
        ghost.className = 'library-sort-ghost';
        ghost.removeAttribute('data-library-card');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.removeAttribute('role');
        ghost.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;`;
        ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        ghost.querySelectorAll('a,button').forEach(node => node.setAttribute('tabindex', '-1'));
        document.body.append(ghost); current.ghost = ghost;
        document.body.classList.add('is-sorting-library');
        frame.current = requestAnimationFrame(tick);
      }
      setDraft(initial); setPicked({ key, keyboard: mode === 'keyboard' });
      setAnnouncement(`已拿起 ${latest.current.name(key)}，拖动或使用方向键调整位置`);
    };
    if (mode === 'keyboard') activate();
    else timer.current = setTimeout(activate, 340);
  }

  useLayoutEffect(() => {
    const elements = Array.from(root.current?.children ?? []) as HTMLElement[];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const element of elements) {
      const running = animations.current.get(element);
      const old = positions.current.get(element.dataset.libraryCard!) ?? (running?.playState === 'running' ? element.getBoundingClientRect() : undefined);
      running?.cancel();
      const next = element.getBoundingClientRect();
      if (old && !reduced && (Math.abs(old.x - next.x) > 1 || Math.abs(old.y - next.y) > 1)) {
        const animation = element.animate([{ transform: `translate(${old.x - next.x}px,${old.y - next.y}px)` }, { transform: 'translate(0,0)' }],
          { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animations.current.set(element, animation);
      }
    }
    positions.current.clear();
    if (picked?.keyboard) elements.find(element => element.dataset.libraryCard === picked.key)?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
  }, [currentOrder, picked]);

  useEffect(() => {
    if (!session.current) setDraft(null);
    else if (disabled || !order.includes(session.current.key)) handlers.current.finish(false);
  }, [order, disabled]);

  const handlers = useRef({ finish, move: (_mode: Session['mode'], _id: number, _x: number, _y: number) => {} });
  handlers.current = { finish, move(mode, id, x, y) {
    const current = session.current;
    if (!current || current.mode !== mode || current.id !== id) return;
    current.x = x; current.y = y;
    if (!current.active && Math.hypot(x - current.startX, y - current.startY) > 8) finish(false);
  } };
  useEffect(() => {
    const move = (event: PointerEvent) => handlers.current.move('pointer', event.pointerId, event.clientX, event.clientY);
    const up = (event: PointerEvent) => { if (session.current?.mode === 'pointer' && session.current.id === event.pointerId) handlers.current.finish(true); };
    const cancel = () => handlers.current.finish(false);
    const cancelPointer = (event: PointerEvent) => { if (session.current?.mode === 'pointer' && session.current.id === event.pointerId) cancel(); };
    const touchStart = (event: TouchEvent) => { if (event.touches.length > 1) cancel(); };
    const touchMove = (event: TouchEvent) => {
      const current = session.current;
      if (!current || current.mode !== 'touch') return;
      const touch = Array.from(event.touches).find(item => item.identifier === current.id);
      if (!touch) return;
      if (current.active && event.cancelable) event.preventDefault();
      handlers.current.move('touch', touch.identifier, touch.clientX, touch.clientY);
    };
    const touchEnd = (event: TouchEvent) => {
      if (session.current?.mode === 'touch' && Array.from(event.changedTouches).some(item => item.identifier === session.current?.id)) handlers.current.finish(true);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); cancel(); } };
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('touchstart', touchStart, { passive: true });
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
    document.addEventListener('touchcancel', cancel);
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', cancel);
    return () => {
      clearTimeout(timer.current); cancelAnimationFrame(frame.current);
      session.current?.ghost?.remove(); session.current = null;
      document.body.classList.remove('is-sorting-library');
      animations.current.forEach(animation => animation.cancel());
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('touchstart', touchStart); document.removeEventListener('touchmove', touchMove); document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', cancel); document.removeEventListener('keydown', escape); document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  return <>
    <p id={hint} className="sr-only">长按卡片拖动排序。键盘按空格拿起，方向键交换，再按空格放下，Escape 取消。</p>
    <div ref={root} className="grid collection-grid library-shelf" role="list" aria-label="音乐库收藏"
      onClickCapture={event => { if (Date.now() < blockedClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
      {currentOrder.map(key => <article key={key} data-library-card={key} role="listitem" aria-describedby={hint}
        className={`library-card-item${picked?.key === key ? picked.keyboard ? ' is-keyboard-sorting' : ' is-dragging' : ''}`}
        onPointerDown={event => {
          if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0 && !(event.target as HTMLElement).closest('button')) begin(event.currentTarget, key, 'pointer', event.pointerId, event.clientX, event.clientY);
        }}
        onTouchStart={event => {
          if (event.touches.length === 1 && !(event.target as HTMLElement).closest('button')) {
            const touch = event.touches[0]; begin(event.currentTarget, key, 'touch', touch.identifier, touch.clientX, touch.clientY);
          }
        }}
        onContextMenu={event => { if (session.current) event.preventDefault(); }}
        onKeyDown={event => {
          if ((event.target as HTMLElement).closest('button')) return;
          const current = session.current;
          if (event.key === ' ') {
            event.preventDefault();
            if (current?.mode === 'keyboard') finish(true); else begin(event.currentTarget, key, 'keyboard', 0, 0, 0);
          } else if (current?.mode === 'keyboard') {
            if (event.key === 'Enter') { event.preventDefault(); finish(true); }
            else if (event.key === 'Tab') finish(true);
            else if (event.key.startsWith('Arrow')) {
              event.preventDefault();
              const columns = getComputedStyle(root.current!).gridTemplateColumns.split(' ').length;
              const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
              const target = current.order[current.order.indexOf(key) + step];
              if (target) exchange(current, target);
            }
          }
        }}>{children(key)}</article>)}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </>;
}
