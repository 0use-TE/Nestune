'use client';
import { useEffect, useRef } from 'react';
import { useApp } from '@/lib/app';
import { Cover } from './Cover';
import { Icon } from './Icon';

export function PlaybackQueue() {
  const app = useApp();
  const selected = useRef<HTMLDivElement>(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [app.index]);

  return (
    <div className="qlist">
      {app.queue.map((song, index) => (
        <div ref={index === app.index ? selected : undefined} key={`${song.id}-${index}`} className={`tr ${index === app.index ? 'cur' : ''}`}>
          <button className="queue-song" aria-current={index === app.index ? true : undefined} onClick={() => app.jumpTo(index)}>
            <Cover src={song.cover} seed={song.id} />
            <span className="t1"><span className="nm t1">{song.name}</span><span className="sub sm t1">{song.artists.map(a => a.name).join(' / ')}</span></span>
          </button>
          <button className="ib queue-remove" aria-label={`移出队列，${song.name}`} onClick={() => app.removeFromQueue(index)}><Icon n="x" s={16} /></button>
        </div>
      ))}
    </div>
  );
}

export function QueuePopover({ inPlayer, onClose }: { inPlayer: boolean; onClose: () => void }) {
  const { queue } = useApp();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !panel.current?.contains(target) && !target.closest('.queue-toggle')) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [onClose]);

  return (
    <section className={`queue-popover ${inPlayer ? 'in-player' : ''}`} ref={panel} id="player-queue" aria-label="播放列表">
      <header><h2>播放列表 <small>{queue.length} 首</small></h2><button className="ib" aria-label="关闭播放列表" onClick={onClose}><Icon n="x" /></button></header>
      <PlaybackQueue />
    </section>
  );
}
