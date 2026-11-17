'use client';
import { useEffect, useId, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Light, non-blocking hints anchored to the actual canvas and player positions. */
export function CanvasGuide({ board, playItem, held, onDismiss }: {
  board: RefObject<HTMLDivElement | null>;
  playItem?: { id: string; x: number; y: number };
  held?: { x: number; y: number; size: number };
  onDismiss: () => void;
}) {
  const marker = useId().replace(/:/g, '');
  const [layout, setLayout] = useState<{ path: string; x: number; y: number; current: boolean } | null>(null);
  useEffect(() => {
    const sync = () => {
      const rect = board.current?.getBoundingClientRect();
      if (!rect) return;
      const player = document.querySelector('#bar .bar-canvas-source');
      const origin = (player ?? document.querySelector('.nc-add'))?.getBoundingClientRect();
      const receiver = document.querySelector('#bar,.nc-empty-player')?.getBoundingClientRect();
      const item = playItem ? Array.from(board.current!.querySelectorAll<HTMLElement>('[data-canvas-item]')).find(node => node.dataset.canvasItem === playItem.id)?.getBoundingClientRect() : undefined;
      const from = held ?? (item ? { x: item.left + item.width / 2, y: item.top + item.height / 2, size: item.height } : undefined);
      if (!origin || playItem && (!receiver || !from)) { setLayout(null); return; }
      const endX = playItem ? receiver!.left + receiver!.width / 2 : rect.left + rect.width * .54;
      const endY = playItem ? receiver!.top + 10 : rect.top + rect.height * .45;
      const startX = playItem ? from!.x : origin.left + origin.width / 2;
      const startY = playItem ? Math.min(from!.y + from!.size * .52, endY - 32) : player ? origin.top - 7 : origin.bottom + 8;
      const bend = playItem ? Math.min(80, Math.abs(endY - startY) * .5) : -Math.min(110, rect.width * .2);
      setLayout({ path: `M ${startX} ${startY} C ${startX + bend} ${startY + (endY - startY) * .4}, ${endX + bend} ${endY}, ${endX} ${endY}`,
        x: Math.max(112, Math.min(window.innerWidth - 112, endX)),
        y: playItem ? endY - 56 : endY + 22, current: !!player });
    };
    sync();
    const observer = new ResizeObserver(sync);
    if (board.current) observer.observe(board.current);
    window.addEventListener('resize', sync); window.visualViewport?.addEventListener('resize', sync);
    return () => { observer.disconnect(); window.removeEventListener('resize', sync); window.visualViewport?.removeEventListener('resize', sync); };
  }, [board, held, playItem]);
  if (!layout) return null;
  return createPortal(<div className={`nc-guide ${playItem ? 'nc-guide-play' : ''}`}>
    <svg aria-hidden="true"><defs><marker id={marker} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M2 1 L8 5 L2 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker></defs><path className="nc-guide-path" d={layout.path} markerEnd={`url(#${marker})`} /></svg>
    <div className="nc-guide-label" style={{ left: layout.x, top: layout.y }} role="status">
      <span>{playItem ? '长按音乐，拖到底部加入播放列表' : layout.current ? '长按歌曲，拖到画布' : '点 + 选音乐，长按拖到画布'}</span>
      {!held && <button type="button" onClick={onDismiss}>知道了</button>}
    </div>
  </div>, document.body);
}
