'use client';
import Link from 'next/link';
import { useApp } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import type { Song } from '@/lib/types';
import { mmss, unplayableText } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';
import { sourceIds } from '@/lib/music-ids';
import { MusicSources } from './MusicSources';
import { PlayingIndicator } from './PlayingIndicator';
import { useRef } from 'react';
import { locateSong } from '@/lib/locate-song';
import { GuideHelp } from './UsageGuide';
export { Loading } from './Loading';

export function SongList({ songs, num = true, onRemove }: { songs: Song[]; num?: boolean; onRemove?: (s: Song) => void }) {
  const app = useApp();
  const selected = useRef<HTMLDivElement>(null);
  const currentIds = app.current ? new Set(sourceIds(app.current)) : null;
  const playingIndex = currentIds ? songs.findIndex(song => sourceIds(song).some(id => currentIds.has(id))) : -1;
  if (!songs.length) return null;
  return (
    <div className="song-list">
      <div className="song-list-tools"><GuideHelp topic="songs" /><button type="button" className="link song-list-locate" disabled={playingIndex < 0} aria-label="在此列表定位当前歌曲" title={playingIndex < 0 ? '当前歌曲不在这份列表里，可从底部播放列表中定位' : '定位当前歌曲'} onClick={() => locateSong(selected.current)}><Icon n="locate" s={16} />定位当前歌曲</button></div>
      {songs.map((s, i) => {
        const cur = i === playingIndex;
        const bad = s.access?.playable === false;
        const device = isDeviceSong(s.id);
        return (
          <div key={`${s.id}-${i}`} ref={cur ? selected : undefined} tabIndex={-1} className={`tr ${cur ? 'cur' : ''} ${bad ? 'dim' : ''}`} data-playing={cur ? app.playing && !app.loading : undefined} onClick={() => (bad ? app.toast(s.access?.reason || '这首歌暂时无法播放') : app.playNow(s))}>
            <div className="no">{cur ? app.loading ? <Loading inline label="正在缓冲歌曲" /> : <PlayingIndicator playing={app.playing} /> : i + 1}</div>
            <Cover src={s.cover} seed={s.id} />
            <div className="t1">
              <div className="nm t1">{device ? <button className="song-name" aria-label={`播放 ${s.name}`}>{s.name}</button> : <span className="song-name">{s.name}</span>}
                {bad && <span className="qtag bad">{unplayableText(s.access?.reason)}</span>}
              </div>
              <div className="sub sm t1">
                {s.artists.map((a, k) => (
                  <span key={a.id || a.name}>{k > 0 && ' / '}{a.id ? <Link href={`/artist/${a.id}`} onClick={e => e.stopPropagation()} className="link" style={{ fontSize: 12 }}>{a.name}</Link> : a.name}</span>
                ))}
                {s.uploader && <span className="song-uploader">{s.artists.length > 0 && ' · '}由 {s.uploader.name} 上传</span>}
              </div>
              <MusicSources song={s} className="music-sources-mobile" />
            </div>
            <div className="sub al song-album-cell">
              <span className="t1">{s.album.id ? <Link href={`/album/${s.album.id}`} onClick={e => e.stopPropagation()}>{s.album.name}</Link> : s.album.name}</span>
              <MusicSources song={s} className="music-sources-desktop" />
            </div>
            <div className="muted du sm">{device && !s.duration ? '' : mmss(s.duration)}</div>
            {device ? <span /> : <button className={`heart ${sourceIds(s).some(id => app.favIds.has(id)) ? 'on' : ''}`} aria-label="收藏" onClick={e => { e.stopPropagation(); app.toggleFav(s); }}><Icon n="heart" s={18} /></button>}
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
