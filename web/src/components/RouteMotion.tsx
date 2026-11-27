'use client';
import { prefersQuietTransitions } from '@/lib/interface-motion';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const detailPath = /^\/(album|artist|playlist|shared|my|people)\/[^/]+$/;

export function RouteMotion({ main }: { main: RefObject<HTMLElement | null> }) {
  const path = usePathname();
  const params = useSearchParams();
  const tab = path === '/search' ? params.get('type') : params.get('tab');
  const item = path === '/library' ? params.get('collection') : path === '/social' ? params.get('domain') : '';
  const key = JSON.stringify([path, tab, item]);
  const detail = detailPath.test(path) || !!item;
  const prior = useRef<{ path: string; key: string; detail: boolean; index: number; tabIndex: number } | null>(null);
  const popped = useRef(false);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const pop = () => {
      // Read the destination before the router synchronously commits its tree.
      popped.current = history.state?.ntMotionKey !== prior.current?.key;
    };
    window.addEventListener('popstate', pop, true);
    return () => window.removeEventListener('popstate', pop, true);
  }, []);
  useLayoutEffect(() => {
    const surface = main.current, wrap = surface?.firstElementChild as HTMLElement | null;
    if (!surface || !wrap) return;
    const last = prior.current;
    const savedEntry = history.state?.ntMotionKey === key && typeof history.state.ntMotionIndex === 'number';
    const returning = popped.current || (savedEntry && last?.key !== key);
    const index = savedEntry ? history.state.ntMotionIndex : (last?.index ?? -1) + 1;
    const back = returning && last && index < last.index;
    const restore = returning || (last?.detail && !detail);
    popped.current = false;
    history.replaceState({ ...history.state, ntMotionKey: key, ntMotionIndex: index }, '', location.href);
    const tabs = Array.from(wrap.querySelectorAll('.motion-tabs .tab'));
    const tabIndex = tabs.findIndex(link => link.hasAttribute('aria-current'));
    prior.current = { path, key, detail, index, tabIndex };
    const reduced = prefersQuietTransitions();
    const withinPage = last?.path === path;
    const target = withinPage ? (wrap.querySelector<HTMLElement>('[data-transition-content]') ?? wrap) : wrap;
    const leavingDetail = last?.detail && !detail;
    const reversingDetail = back && (detail || last?.detail);
    const detailDirection = leavingDetail || reversingDetail ? -1 : detail ? 1 : 0;
    let transform = 'none';
    if (!reduced && last) {
      if (detailDirection) transform = `translateX(${detailDirection * 24}px)`;
      else if (withinPage) transform = `translateX(${tabIndex < last.tabIndex ? -56 : 56}px)`;
      else {
        const pages = Array.from(document.querySelectorAll<HTMLAnchorElement>('#tabbar a'), a => a.pathname);
        transform = `translateY(${pages.indexOf(path) < pages.indexOf(last.path) ? -38 : 38}px)`;
      }
    }
    const animation = last && last.key !== key && target.animate?.([
      { opacity: reduced ? .7 : .08, transform },
      { opacity: 1, transform: 'none' },
    ], { duration: reduced ? 120 : withinPage ? 410 : 460, easing: 'cubic-bezier(.22,.65,.22,1)' });
    const goal = restore ? positions.current.get(key) ?? 0 : 0;
    let waiting = goal > 0;
    const apply = () => {
      if (!waiting) return;
      surface.scrollTop = goal;
      if (Math.abs(surface.scrollTop - goal) < 2) waiting = false;
    };
    if (!goal) surface.scrollTop = 0;
    apply();
    const observer = new ResizeObserver(apply);
    if (waiting) observer.observe(wrap);
    const stop = () => { waiting = false; observer.disconnect(); };
    const save = () => { if (!waiting) positions.current.set(key, surface.scrollTop); };
    surface.addEventListener('scroll', save, { passive: true });
    surface.addEventListener('wheel', stop, { passive: true });
    surface.addEventListener('touchstart', stop, { passive: true });
    return () => {
      if (animation) animation.cancel();
      observer.disconnect();
      surface.removeEventListener('scroll', save);
      surface.removeEventListener('wheel', stop);
      surface.removeEventListener('touchstart', stop);
    };
  }, [key, path, detail, main]);
  return null;
}
