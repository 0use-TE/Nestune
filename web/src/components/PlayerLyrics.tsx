'use client';
import { useEffect, useRef, useState } from 'react';
import type { LyricLine } from '@/lib/types';

export function PlayerLyrics({ lines, active, status, showTranslation, onSeek, onBackgroundClick }: {
  lines: LyricLine[]; active: number; status: string; showTranslation: boolean; onSeek: (seconds: number) => void;
  onBackgroundClick: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const hasIntro = !!lines[0] && lines[0].t > 0;

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  useEffect(() => {
    const panel = box.current;
    const line = panel?.querySelector<HTMLElement>('[data-lyric-focus]') ?? panel?.querySelector<HTMLElement>('.ln');
    if (browsing || !panel || !line) return;
    const center = () => panel.scrollTo({ top: line.offsetTop + (line.offsetHeight - panel.clientHeight) / 2 });
    const resize = new ResizeObserver(center);
    resize.observe(panel);
    center();
    return () => resize.disconnect();
  }, [active, lines, browsing, showTranslation]);

  function holdLyrics(resume: boolean) {
    clearTimeout(resumeTimer.current);
    setBrowsing(true);
    if (resume) resumeTimer.current = setTimeout(() => setBrowsing(false), 4000);
  }

  function endDrag(id: number) {
    const start = drag.current;
    if (start?.id !== id) return;
    drag.current = null;
    setDragging(false);
    if (start.moved) holdLyrics(true);
  }

  return (
    <div className="lyric-view">
      <div id="lyr" ref={box} aria-label="歌词" data-dragging={dragging || undefined}
        onWheel={() => { if (lines.length) holdLyrics(true); }}
        onTouchMove={() => {
          suppressClick.current = true;
          if (lines.length) holdLyrics(true);
        }}
        onPointerDown={event => {
          suppressClick.current = false;
          if (!lines.length || event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
          drag.current = { id: event.pointerId, y: event.clientY, top: event.currentTarget.scrollTop, moved: false };
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (start?.id !== event.pointerId) return;
          const distance = event.clientY - start.y;
          if (!start.moved) {
            if (Math.abs(distance) < 6) return;
            start.moved = true;
            suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            holdLyrics(false);
          }
          event.currentTarget.scrollTo({ top: start.top - distance, behavior: 'instant' });
        }}
        onPointerLeave={event => { if (!drag.current?.moved) endDrag(event.pointerId); }}
        onPointerUp={event => endDrag(event.pointerId)}
        onPointerCancel={event => endDrag(event.pointerId)}
        onLostPointerCapture={event => endDrag(event.pointerId)}
        onClickCapture={event => {
          if (!suppressClick.current || event.detail === 0) return;
          suppressClick.current = false;
          event.stopPropagation();
        }}
        onClick={event => {
          if (event.target instanceof Element && !event.target.closest('.ln')) onBackgroundClick();
        }}>
        {status && <div className="ln-status">{status}</div>}
        {hasIntro && <div className="lyric-intro" aria-hidden={active >= 0} data-lyric-focus={active < 0 ? '' : undefined}>前奏</div>}
        {lines.map((line, index) => (
          <button type="button" key={index} className={`ln ${Math.abs(index - active) === 1 ? 'near' : ''}`}
            aria-current={index === active ? true : undefined} data-lyric-focus={index === active ? '' : undefined}
            onClick={() => { clearTimeout(resumeTimer.current); onSeek(line.t); setBrowsing(false); }}>
            {line.text}{showTranslation && line.tr && <small>{line.tr}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
