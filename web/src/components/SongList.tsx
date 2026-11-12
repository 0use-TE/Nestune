'use client';
import Link from 'next/link';
import { useApp } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import type { Song } from '@/lib/types';
import { mmss, unplayableText } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';

export function SongList({ songs, num = true, onRemove }: { songs: Song[]; num?: boolean; onRemove?: (s: Song) => void }) {
  const app = useApp();
  if (!songs.length) return null;
  return (
    <div>
      {songs.map((s, i) => {
        const cur = app.current?.id === s.id;
        const bad = s.access?.playable === false;
        const device = isDeviceSong(s.id);
        return (
          <div key={`${s.id}-${i}`} className={`tr ${cur ? 'cur' : ''} ${bad ? 'dim' : ''}`} onClick={() => (bad ? app.toast(s.access?.reason || '这首歌暂时无法播放') : app.play(songs, i))}>
            <div className="no">{cur && !app.loading ? <span className={`eq ${app.playing ? '' : 'off'}`}><i /><i /><i /></span> : i + 1}</div>
            <Cover src={s.cover} seed={s.id} />
            <div className="t1">
              <div className="nm t1">{device ? <button aria-label={`播放 ${s.name}`}>{s.name}</button> : s.name}
                {cur && app.loading && <span className="sub sm"> · 加载中…</span>}
                {bad && <span className="qtag bad">{unplayableText(s.access?.reason)}</span>}
              </div>
              <div className="sub sm t1">
                {s.artists.map((a, k) => (
                  <span key={a.id}>{k > 0 && ' / '}<Link href={`/artist/${a.id}`} onClick={e => e.stopPropagation()} className="link" style={{ fontSize: 12 }}>{a.name}</Link></span>
                ))}
              </div>
            </div>
            <div className="sub al t1">{s.album.id ? <Link href={`/album/${s.album.id}`} onClick={e => e.stopPropagation()}>{s.album.name}</Link> : s.album.name}</div>
            <div className="muted du sm">{device && !s.duration ? '' : mmss(s.duration)}</div>
            {device ? <span /> : <button className={`heart ${app.favIds.has(s.id) ? 'on' : ''}`} aria-label="收藏" onClick={e => { e.stopPropagation(); app.toggleFav(s); }}><Icon n="heart" s={18} /></button>}
            {onRemove
              ? <button className="more" aria-label="移除" onClick={e => { e.stopPropagation(); onRemove(s); }}><Icon n="x" s={18} /></button>
              : <button className="more" aria-label="更多" onClick={e => { e.stopPropagation(); app.openMenu(s, e); }}><Icon n="more" s={18} /></button>}
          </div>
        );
      })}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="center sub">{text}</div>;
}
export function Loading() {
  return <div className="center sub">加载中…</div>;
}
