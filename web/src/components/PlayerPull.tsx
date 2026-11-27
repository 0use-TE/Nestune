'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

/** Separate from the cover's long press, seek bar and horizontal chat gesture. */
export function PlayerPull({ open, toggle }: { open: boolean; toggle: () => void }) {
  const gesture = useRef<{ y: number; id: number; delta: number; panel: HTMLElement } | null>(null);
  const suppress = useRef(false);
  function finish(commit: boolean) {
    const held = gesture.current;
    if (!held) return;
    gesture.current = null;
    delete held.panel.dataset.pull;
    held.panel.style.removeProperty('--player-hidden');
    held.panel.style.removeProperty('--player-opacity');
    if (Math.abs(held.delta) > 5) {
      suppress.current = true;
      if (commit && held.delta > Math.min(84, held.panel.clientHeight * .16)) toggle();
    }
  }
  useEffect(() => () => {
    const held = gesture.current;
    if (held) {
      delete held.panel.dataset.pull;
      held.panel.style.removeProperty('--player-hidden');
      held.panel.style.removeProperty('--player-opacity');
    }
  }, []);
  return <button type="button" className={open ? 'ib close player-pull' : 'player-pull bar-pull'}
    aria-label={open ? '收起' : '展开播放器'} aria-controls="np"
    onPointerDown={e => {
      if (e.button !== 0 || !e.isPrimary) return;
      const panel = document.getElementById('np');
      if (!panel) return;
      suppress.current = false;
      gesture.current = { y: e.clientY, id: e.pointerId, delta: 0, panel };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const held = gesture.current;
      if (!held || held.id !== e.pointerId) return;
      held.delta = Math.max(0, (e.clientY - held.y) * (open ? 1 : -1));
      if (held.delta < 5 && !held.panel.dataset.pull) return;
      const progress = Math.min(1, held.delta / Math.max(1,held.panel.clientHeight));
      held.panel.style.setProperty('--player-hidden', (100 * (open ? progress : 1 - progress)) + '%');
      held.panel.style.setProperty('--player-opacity', String(open ? 1 - progress : progress));
      held.panel.dataset.pull = 'true';
    }}
    onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
    onClick={e => { if (!e.detail || !suppress.current) toggle(); suppress.current = false; }}>
    {open ? <Icon n="down" s={24} /> : <i aria-hidden="true" />}
  </button>;
}
