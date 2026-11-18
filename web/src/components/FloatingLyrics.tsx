'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import { LyricsClientUpgrade, useDesktopLyrics } from './DesktopLyrics';
import { useApp } from '@/lib/app';
import { LYRICS_IDLE_MS, LyricsPlaybackControls } from './PlaybackControls';

type Position = { x: number; y: number };
const INSET = 8;

function keepInViewport(position: Position, card: HTMLElement): Position {
  return {
    x: Math.max(INSET, Math.min(position.x, document.documentElement.clientWidth - card.offsetWidth - INSET)),
    y: Math.max(INSET, Math.min(position.y, window.innerHeight - card.offsetHeight - INSET)),
  };
}

export function FloatingLyrics({ visible, text, translation, title, onClose }: {
  visible: boolean; text: ReactNode; translation?: string; title?: string; onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const app = useApp();
  const desktopLyrics = useDesktopLyrics();
  const drag = useRef<{ id: number; offset: Position } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    clearTimeout(idleTimer.current);
    setIdle(false);
    idleTimer.current = setTimeout(() => setIdle(true), LYRICS_IDLE_MS);
  }, []);
  useEffect(() => {
    if (!visible) return;
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [visible, wake]);

  useEffect(() => {
    try { setTransparent(localStorage.getItem('nt-lyric-transparent') === '1'); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    const element = card.current;
    if (!visible || !element) { drag.current = null; return; }
    const fit = () => setPosition(previous => {
      if (!previous) return null;
      const next = keepInViewport(previous, element);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [visible]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || !card.current) return;
    const { left, top } = card.current.getBoundingClientRect();
    drag.current = { id: event.pointerId, offset: { x: event.clientX - left, y: event.clientY - top } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId || !card.current) return;
    setPosition(keepInViewport({ x: event.clientX - active.offset.x, y: event.clientY - active.offset.y }, card.current));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function toggleBackground() {
    const next = !transparent;
    setTransparent(next);
    try { localStorage.setItem('nt-lyric-transparent', next ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  if (!visible) return null;
  const popoutLabel = desktopLyrics.platform === 'android' ? '在其他应用上显示歌词' : '移到桌面';
  return (
    <div className="pinned-lyrics">
      <div ref={card} className={`pinned-lyrics-card ${transparent ? 'transparent' : ''}`} aria-label="歌词"
        onPointerEnter={wake} onPointerMove={wake} onPointerDownCapture={wake} onFocusCapture={wake}
        style={position ? { position: 'fixed', left: position.x, top: position.y } : undefined}>
        <div className="pinned-lyrics-text" title="拖动歌词" onPointerDown={startDrag} onPointerMove={move}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
          <div>{text}</div>
          {translation && <small>{translation}</small>}
          {title && <small>{title}</small>}
        </div>
        <div className="pinned-lyrics-actions" data-idle={idle || undefined}>
          <LyricsPlaybackControls mode={app.playbackMode} playing={app.playing}
            onControl={action => {
              if (action === 'mode') app.cyclePlaybackMode();
              else if (action === 'previous') app.prev();
              else if (action === 'next') app.next();
              else app.toggle();
            }} />
          {desktopLyrics.supported && <button type="button" className="ib" aria-label={popoutLabel} title={popoutLabel} disabled={desktopLyrics.busy} onClick={() => void desktopLyrics.setEnabled(true)}><Icon n="popout" s={16} /></button>}
          <button className={`ib ${transparent ? 'act' : ''}`} aria-label="透明背景" aria-pressed={transparent} title={transparent ? '显示歌词背景' : '透明背景'} onClick={toggleBackground}><Icon n="opacity" s={16} /></button>
          <button className="ib" aria-label="关闭歌词" title="关闭歌词" onClick={onClose}><Icon n="x" s={16} /></button>
        </div>
      </div>
      {(desktopLyrics.status || desktopLyrics.upgradeRequired) && <div className="pinned-lyrics-status" role="status">
        {desktopLyrics.status && <p>{desktopLyrics.status}</p>}
        {desktopLyrics.upgradeRequired && <LyricsClientUpgrade />}
      </div>}
    </div>
  );
}
