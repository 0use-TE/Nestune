'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function MotionTabs({ label, selected, className = '', children }: {
  label: string; selected: string; className?: string; children: ReactNode;
}) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const row = nav.current!;
    const active = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const align = () => {
      row.style.setProperty('--indicator-left', active.offsetLeft + 'px');
      row.style.setProperty('--indicator-width', active.offsetWidth + 'px');
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(row);
    for (const link of row.querySelectorAll('a')) observer.observe(link);
    return () => observer.disconnect();
  }, [selected]);
  return <nav ref={nav} aria-label={label} className={`tabs motion-tabs ${className}`}>
    {children}<span className="tab-indicator" aria-hidden="true" />
  </nav>;
}
