'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApp } from '@/lib/app';
import { post } from '@/lib/api';
import { useSocial } from '@/lib/social';
import { mmss } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';
import { CanvasSource } from './CanvasSource';
import { PlayingIndicator } from './PlayingIndicator';
import { locateSong } from '@/lib/locate-song';
import { GuideHelp } from './UsageGuide';

export function PlaybackQueue({ currentRow }: { currentRow?: RefObject<HTMLDivElement | null> } = {}) {
  const app = useApp();
  const ownSelected = useRef<HTMLDivElement>(null), selected = currentRow ?? ownSelected;
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [app.index]);

  return (
    <div className="qlist">
      {app.queue.map((song, index) => (
        <CanvasSource key={`${song.id}-${index}`} source={{ kind: 'song', songId: song.id, name: song.name, cover: song.cover, previewSong: song }}><div ref={index === app.index ? selected : undefined} tabIndex={-1} className={`tr ${index === app.index ? 'cur' : ''}`} data-playing={index === app.index ? app.playing && !app.loading : undefined}>
          <button className="queue-song" aria-current={index === app.index ? true : undefined} onClick={() => app.jumpTo(index)}>
            <span className="queue-number" aria-hidden="true">{index === app.index ? app.loading ? <Loading inline /> : <PlayingIndicator playing={app.playing} /> : String(index + 1).padStart(2, '0')}</span>
            <Cover src={song.cover} seed={song.id} />
            <span className="t1"><span className="nm t1"><span className="song-name">{song.name}</span></span><span className="sub sm t1">{song.artists.map(a => a.name).join(' / ')}</span></span>
          </button>
          <span className="queue-duration sub sm">{mmss(song.duration)}</span>
          <button className="ib queue-remove" aria-label={`移出队列，${song.name}`} onClick={() => app.removeFromQueue(index)}><Icon n="x" s={16} /></button>
        </div></CanvasSource>
      ))}
      {!app.queue.length && <div className="queue-empty"><Icon n="note" s={28} /><p>列表为空</p></div>}
    </div>
  );
}

export function QueuePopover({ inPlayer, onClose }: { inPlayer: boolean; onClose: () => void }) {
  const app = useApp();
  const { queue } = app;
  const currentRow = useRef<HTMLDivElement>(null);
  const social = useSocial();
  const room = social.state?.rooms.find(room => room.active && room.onThisDevice);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('一起听的音乐');
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!room || busy) return;
    setBusy(true);
    try {
      await post('/api/social', { action: 'saveRoomQueue', roomId: room.id, name });
      await app.reloadPlaylists(); setSaving(false); app.toast('共同列表已保存为你的歌单');
    } catch (e) { app.toast(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !panel.current?.contains(target) && !target.closest('.queue-toggle,.usage-guide')) onClose();
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
      <header><CanvasSource source={{ kind: 'queue', name: app.sharedQueue ? '共同播放列表' : '播放列表', cover: queue[0]?.cover, previewSong: queue[0], songIds: queue.map(s => s.id) }}><h2 title="拖到画布分享整个播放列表">{app.sharedQueue ? '共同播放列表' : '播放列表'} <small>{queue.length} 首</small></h2></CanvasSource>
        <div className="queue-header-actions">
          <GuideHelp topic="queue" />
          <button type="button" className="ib queue-locate" aria-label="定位当前播放歌曲" title="定位当前歌曲" disabled={!app.current || !queue.length} onClick={() => locateSong(currentRow.current)}><Icon n="locate" s={18} /></button>
          <button type="button" className="link queue-clear" disabled={!queue.length} onClick={app.clearQueue}><Icon n="trash" s={14} />清空</button>
          <button className="ib" aria-label="关闭播放列表" onClick={onClose}><Icon n="x" s={20} /></button>
        </div>
      </header>
      {app.sharedQueue && <div className="queue-toolbar"><button type="button" className="link" disabled={!queue.length} onClick={() => setSaving(value => !value)}><Icon n="plus" s={14} />保存为歌单</button></div>}
      {saving && <form className="queue-save" onSubmit={save}><input aria-label="歌单名称" value={name} onChange={e => setName(e.target.value)} maxLength={40} required autoFocus /><button className="btn sm" disabled={busy || !name.trim()}>{busy ? <Loading inline label="正在保存歌单" /> : '保存'}</button></form>}
      <PlaybackQueue currentRow={currentRow} />
    </section>
  );
}
