'use client';
import { Loading } from './Loading';
import { useState } from 'react';
import { useApp, useClock } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import { mmss } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';

export function PlayerBar({ lyricsPinned, onToggleLyrics, queueOpen, onToggleQueue, onDetails }: {
  lyricsPinned: boolean; onToggleLyrics: () => void; queueOpen: boolean; onToggleQueue: () => void; onDetails: () => void;
}) {
  const app = useApp();
  const { time, duration } = useClock();
  const [infoPressed, setInfoPressed] = useState(false);
  const s = app.current;
  if (!s) return null;
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div id="bar">
      <button className="info" data-pressed={infoPressed || undefined} onClick={onDetails}
        onPointerDown={event => { if (event.isPrimary && event.button === 0) setInfoPressed(true); }}
        onPointerUp={() => setInfoPressed(false)} onPointerCancel={() => setInfoPressed(false)} onPointerLeave={() => setInfoPressed(false)}
        aria-label={`歌曲详情，${s.name}`} aria-expanded={app.nowOpen} aria-controls="np" title="歌曲详情">
        <Cover src={s.cover} seed={s.id} />
        <span><b className="t1">{s.name}</b><span className="sub sm t1">{app.error || s.artists.map(a => a.name).join(' / ')}</span></span>
      </button>
      <div className="ctl">
        <button className="ib prev" aria-label="上一首" onClick={app.prev}><Icon n="prev" /></button>
        <button className="ib play" aria-busy={app.loading} aria-label={app.playing ? '暂停' : '播放'} onClick={app.toggle}>{app.loading ? <Loading inline label="正在缓冲歌曲" /> : <Icon n={app.playing ? 'pause' : 'play'} s={20} />}</button>
        <button className="ib next" aria-label="下一首" onClick={app.next}><Icon n="next" /></button>
      </div>
      <div className="right">
        <span className="sub sm">{mmss(time)} / {mmss(duration || s.duration)}</span>
        {!isDeviceSong(s.id) && <button className={`ib heartb ${app.favIds.has(s.id) ? 'on' : ''}`} aria-label="收藏" onClick={() => app.toggleFav(s)}><Icon n="heart" /></button>}
        <button className={`ib bar-lyrics ${lyricsPinned ? 'act' : ''}`} aria-label="歌词" aria-pressed={lyricsPinned} title="歌词" onClick={onToggleLyrics}><Icon n={lyricsPinned ? 'lyricsOn' : 'lyrics'} /></button>
        <button className={`ib bar-queue queue-toggle ${queueOpen ? 'act' : ''}`} aria-label="播放列表" aria-expanded={queueOpen} aria-controls={queueOpen ? 'player-queue' : undefined} title="播放列表" onClick={onToggleQueue}><Icon n="list" /></button>
      </div>
      <div className="prog">
        <div className="track" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); app.seek(((e.clientX - r.left) / r.width) * (duration || s.duration)); }}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
