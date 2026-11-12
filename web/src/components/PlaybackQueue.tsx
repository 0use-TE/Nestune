'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app';
import { post } from '@/lib/api';
import { useSocial } from '@/lib/social';
import { mmss } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';

export function PlaybackQueue() {
  const app = useApp();
  const selected = useRef<HTMLDivElement>(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [app.index]);

  return (
    <div className="qlist">
      {app.queue.map((song, index) => (
        <div ref={index === app.index ? selected : undefined} key={`${song.id}-${index}`} className={`tr ${index === app.index ? 'cur' : ''}`}>
          <button className="queue-song" aria-current={index === app.index ? true : undefined} onClick={() => app.jumpTo(index)}>
            <span className="queue-number" aria-hidden="true">{index === app.index ? app.loading ? <Loading inline /> : <Icon n={app.playing ? 'vol' : 'pause'} s={14} /> : String(index + 1).padStart(2, '0')}</span>
            <Cover src={song.cover} seed={song.id} />
            <span className="t1"><span className="nm t1">{song.name}</span><span className="sub sm t1">{song.artists.map(a => a.name).join(' / ')}</span></span>
          </button>
          <span className="queue-duration sub sm">{mmss(song.duration)}</span>
          <button className="ib queue-remove" aria-label={`移出队列，${song.name}`} onClick={() => app.removeFromQueue(index)}><Icon n="x" s={16} /></button>
        </div>
      ))}
      {!app.queue.length && <div className="queue-empty"><Icon n="note" s={28} /><p>列表为空</p></div>}
    </div>
  );
}

export function QueuePopover({ inPlayer, onClose }: { inPlayer: boolean; onClose: () => void }) {
  const app = useApp();
  const { queue } = app;
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
      <header><h2>{app.sharedQueue ? '共同播放列表' : '播放列表'} <small>{queue.length} 首</small></h2><button className="ib" aria-label="关闭播放列表" onClick={onClose}><Icon n="x" s={20} /></button></header>
      <div className="queue-toolbar"><div>
        {app.sharedQueue && <button type="button" className="link" disabled={!queue.length} onClick={() => setSaving(value => !value)}><Icon n="plus" s={14} />保存为歌单</button>}
        <button type="button" className="link queue-clear" disabled={!queue.length} onClick={app.clearQueue}><Icon n="trash" s={14} />清空</button>
      </div></div>
      {saving && <form className="queue-save" onSubmit={save}><input aria-label="歌单名称" value={name} onChange={e => setName(e.target.value)} maxLength={40} required autoFocus /><button className="btn sm" disabled={busy || !name.trim()}>{busy ? <Loading inline label="正在保存歌单" /> : '保存'}</button></form>}
      <PlaybackQueue />
    </section>
  );
}
