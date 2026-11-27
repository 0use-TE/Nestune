'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { GUIDE_LABELS, GUIDE_STEPS, GUIDE_TOPICS, guideStorageKey, pageGuide, type GuideTopic } from '@/lib/usage-guides';
import { Icon } from './Icon';

export function GuideHelp({ topic, children }: { topic: GuideTopic; children?: React.ReactNode }) {
  return <button type="button" className="guide-help link" aria-label={`查看${GUIDE_LABELS[topic]}介绍`}
    onClick={() => window.dispatchEvent(new CustomEvent('nt:guide-open', { detail: topic }))}><Icon n="info" s={16} />{children}</button>;
}

export function UsageGuide({ userId, queueOpen, hasSong, blocked = false }: { userId: number; queueOpen: boolean; hasSong: boolean; blocked?: boolean }) {
  const path = usePathname();
  const [active, setActive] = useState<GuideTopic | null>(null), [step, setStep] = useState(0);
  const [layout, setLayout] = useState<{ left: number; top: number; rect?: { left: number; top: number; width: number; height: number } }>();
  const [dragging, setDragging] = useState(false);
  const [obscured, setObscured] = useState(false);
  const activeRef = useRef(active); activeRef.current = active;
  const seen = useRef(new Set<string>()), panel = useRef<HTMLElement>(null);
  const completed = (topic: GuideTopic) => {
    const key = guideStorageKey(userId, topic);
    if (seen.current.has(key)) return true;
    try { return localStorage.getItem(key) === 'done'; } catch { return false; }
  };
  const close = () => {
    if (active) { const key = guideStorageKey(userId, active); seen.current.add(key); try { localStorage.setItem(key, 'done'); } catch {} }
    setActive(null);
  };
  useEffect(() => {
    const topic = pageGuide(path, queueOpen, hasSong);
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (cancelled || !topic || completed(topic) || activeRef.current) return;
      if (blocked || document.querySelector('[role="dialog"],.mask,.sheet-layer,.pwa-intro,.pwa-update,.release-notice') || document.body.hasAttribute('data-friend-song-drag')) { timer = setTimeout(attempt, 600); return; }
      setActive(topic); setStep(0);
    };
    timer = setTimeout(attempt, 3400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [path, queueOpen, hasSong, userId, blocked]);
  useEffect(() => { setActive(null); setStep(0); }, [path, userId]);
  useEffect(() => { if (!queueOpen) setActive(topic => topic === 'queue' ? null : topic); }, [queueOpen]);
  useEffect(() => {
    const sync = () => setObscured(!!document.querySelector('[role="dialog"],.mask,.sheet-layer'));
    sync(); const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const open = (event: Event) => {
      const topic = (event as CustomEvent).detail;
      if (!GUIDE_TOPICS.includes(topic)) return;
      setActive(topic); setStep(0);
    };
    const begin = () => setDragging(document.body.hasAttribute('data-friend-song-drag')), end = () => setDragging(false);
    window.addEventListener('nt:guide-open', open); window.addEventListener('nt:friend-song-source', begin); window.addEventListener('nt:friend-song-finish', end);
    return () => { window.removeEventListener('nt:guide-open', open); window.removeEventListener('nt:friend-song-source', begin); window.removeEventListener('nt:friend-song-finish', end); };
  }, []);
  useEffect(() => {
    if (!active || obscured || blocked) return;
    const sync = () => {
      const viewport = window.visualViewport, width = viewport?.width || innerWidth, height = viewport?.height || innerHeight, offset = viewport?.offsetTop || 0;
      const targets = GUIDE_STEPS[active][step].target.split(',').flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]);
      const bounds = targets.map(node => node.getBoundingClientRect()).find(rect => rect.width > 0 && rect.height > 0 && rect.bottom > offset && rect.top < offset + height);
      const cardWidth = Math.min(340, width - 24), cardHeight = panel.current?.offsetHeight || 220;
      const left = Math.max(12, Math.min(width - cardWidth - 12, bounds ? bounds.left + bounds.width / 2 - cardWidth / 2 : width - cardWidth - 18));
      const desired = bounds ? bounds.bottom + 12 + cardHeight <= offset + height - 12 ? bounds.bottom + 12 : bounds.top - cardHeight - 12 : offset + height - cardHeight - 100;
      setLayout({ left, top: Math.max(offset + 12, Math.min(offset + height - cardHeight - 12, desired)),
        rect: bounds ? { left: bounds.left - 3, top: bounds.top - 3, width: bounds.width + 6, height: bounds.height + 6 } : undefined });
    };
    sync(); const frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync); if (panel.current) observer.observe(panel.current);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('resize', sync); document.addEventListener('scroll', sync, true); document.addEventListener('keydown', key);
    window.visualViewport?.addEventListener('resize', sync);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync); document.removeEventListener('scroll', sync, true); document.removeEventListener('keydown', key); window.visualViewport?.removeEventListener('resize', sync); };
  }, [active, step, dragging, obscured, blocked]);
  if (!active || dragging || obscured || blocked) return null;
  const steps = GUIDE_STEPS[active], current = steps[step];
  return createPortal(<div className="usage-guide-layer">
    {layout?.rect && <div className="usage-guide-ring" style={layout.rect} aria-hidden="true" />}
    <section ref={panel} className="usage-guide" role="region" aria-label={`${GUIDE_LABELS[active]}使用介绍`} style={layout ? { left: layout.left, top: layout.top } : { visibility: 'hidden' }}>
      <header><span className="sub sm">{GUIDE_LABELS[active]} · {step + 1} / {steps.length}</span><button type="button" className="ib" aria-label="关闭使用介绍" onClick={close}><Icon n="x" s={16} /></button></header>
      <div aria-live="polite"><div key={current.title} className="guide-step"><h3>{current.title}</h3><p>{current.text}</p></div></div>
      <footer><button type="button" className="link sm" onClick={close}>跳过介绍</button><div className="row">{step > 0 && <button type="button" className="link sm" onClick={() => setStep(value => value - 1)}>上一步</button>}<button type="button" className="btn sm" onClick={() => step + 1 === steps.length ? close() : setStep(value => value + 1)}>{step + 1 === steps.length ? '知道了' : '下一步'}</button></div></footer>
    </section>
  </div>, document.body);
}

export function GuideDirectory() {
  return <div className="set guide-directory"><div><b>使用指南</b><p className="sub sm">首次介绍看过后，也可以在这里重新查看</p></div><div className="row">{GUIDE_TOPICS.map(topic => <GuideHelp key={topic} topic={topic}>{GUIDE_LABELS[topic]}</GuideHelp>)}</div></div>;
}
