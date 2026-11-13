'use client';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { registerOverlay } from '@/lib/overlays';
import { Icon } from './Icon';

export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const sync = () => setViewport({ top: window.visualViewport?.offsetTop || 0, height: window.visualViewport?.height || window.innerHeight });
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    const frame = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('input') || panel.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true }));
    const remove = registerOverlay(() => close.current());
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]') || []);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      remove(); cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('keydown', key, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className="sheet-layer" style={viewport ? { top: viewport.top, height: viewport.height } : undefined} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className={`sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header className="sheet-heading"><h2 id={id}>{title}</h2><button type="button" className="ib" aria-label={`关闭${title}`} onClick={onClose}><Icon n="x" s={20} /></button></header>
      {children}
    </section>
  </div>, document.body);
}
