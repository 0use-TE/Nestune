'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useApp, useClock } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import { useSocial } from '@/lib/social';
import type { LyricLine } from '@/lib/types';
import { QUALITY_LABEL, mmss } from '@/lib/util';
import { Cover } from './Cover';
import { Conversation } from './Conversation';
import { FloatingLyrics } from './FloatingLyrics';
import { Icon } from './Icon';
import { PlayerLyrics } from './PlayerLyrics';
import { PlayerTogether } from './PlayerTogether';

const PLAYBACK_ICONS = {
  off: ['repeatOff', '不循环'],
  all: ['repeat', '列表循环'],
  one: ['repeat', '单曲循环'],
  shuffle: ['shuffle', '随机播放'],
} as const;
const CREDIT = /^\s*(?:作词|作曲|词曲|词\s*[/／]\s*曲|编曲|制作人?|监制|演唱|出品|录音(?:师)?|混音(?:师)?|母带(?:工程师)?|和声|吉他|贝斯|鼓手|lyricist|composer|arranger|producer|written by|produced by)\s*[:：]/i;

export function NowPlaying({ lyricsPinned, onToggleLyrics, queueOpen, onToggleQueue }: {
  lyricsPinned: boolean; onToggleLyrics: () => void; queueOpen: boolean; onToggleQueue: () => void;
}) {
  const app = useApp();
  const social = useSocial();
  const { time, duration } = useClock();
  const s = app.current;
  const songId = s?.id;
  const deviceSong = !!songId && isDeviceSong(songId);
  const [lyrics, setLyrics] = useState<{ id: string; lines: LyricLine[]; credits: string[] } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [mobileCover, setMobileCover] = useState(true);
  const [keepPlayerContents, setKeepPlayerContents] = useState(false);
  const showPlayerContents = app.nowOpen || keepPlayerContents;
  const hasRoom = !!social.state?.rooms.length;
  const room = social.state?.rooms.find(item => item.active && item.onThisDevice);
  const partner = room && social.state?.people.find(person => person.id === (room.hostId === app.me?.id ? room.guestId : room.hostId));
  const activeRoom = room && partner ? { room, peer: partner } : null;
  const needsLyrics = app.nowOpen || lyricsPinned;

  useEffect(() => {
    if (app.nowOpen) {
      setKeepPlayerContents(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setKeepPlayerContents(false);
      return;
    }
    const timeout = window.setTimeout(() => setKeepPlayerContents(false), 300);
    return () => window.clearTimeout(timeout);
  }, [app.nowOpen]);

  useEffect(() => {
    if (!songId || deviceSong || !needsLyrics) return;
    let live = true;
    get<{ lines: LyricLine[] }>(`/api/songs/${songId}/lyrics`).then(({ lines }) => {
      if (!live) return;
      let first = 0;
      let end = lines.length;
      while (first < end && CREDIT.test(lines[first].text)) first++;
      while (end > first && CREDIT.test(lines[end - 1].text)) end--;
      setLyrics({ id: songId, lines: lines.slice(first, end), credits: [...lines.slice(0, first), ...lines.slice(end)].map(line => line.text) });
    }).catch(() => { if (live) setLyrics({ id: songId, lines: [], credits: [] }); });
    return () => { live = false; };
  }, [songId, deviceSong, needsLyrics]);

  const currentLyrics = lyrics?.id === songId ? lyrics : null;
  const lines = currentLyrics?.lines ?? [];
  let active = -1;
  for (let i = 0; i < lines.length && lines[i].t <= time; i++) active = i;
  const currentLine = lines[active];
  const lyricStatus = deviceSong ? '暂无歌词' : !currentLyrics ? '加载歌词…' : !lines.length ? '暂无歌词' : '';

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) app.setNowOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [app.setNowOpen]);

  if (!s) return null;
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  const [modeIcon, modeLabel] = PLAYBACK_ICONS[app.playbackMode];
  const { quality, source } = app.audioInfo ?? {};
  const sourceLabel = source === 'cache' ? '' : source === 'library' ? '服务器音乐库' : '在线';
  const audioLabel = quality
    ? [`${QUALITY_LABEL[quality] || quality}音质`, sourceLabel].filter(Boolean).join(' · ')
    : deviceSong ? '设备本地播放' : '在线播放';
  const toggleMobileArt = () => setMobileCover(cover => !cover);
  const qualityText = <>{audioLabel}{app.loading && ' · 加载中…'}</>;
  const queueButton = (
    <button className={`ib queue-toggle ${queueOpen ? 'act' : ''}`} aria-label="播放列表" aria-expanded={queueOpen}
      aria-controls={queueOpen ? 'player-queue' : undefined} title="播放列表" onClick={onToggleQueue}><Icon n="list" s={22} /></button>
  );

  return (
    <>
      <div id="np" className={app.nowOpen ? 'open' : ''} inert={!app.nowOpen} data-mobile-cover={mobileCover || undefined} data-playing={app.playing || undefined}>
        {showPlayerContents && s.cover && <div className="np-mobile-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(s.cover)})` }} />}
        <button className="ib close" aria-label="收起" onClick={() => app.setNowOpen(false)}><Icon n="down" s={24} /></button>
        <div className="left">
          <div className="np-art">
            <div className="np-record" key={songId}><Cover src={s.cover} seed={s.id} /></div>
            <div className="np-needle" aria-hidden="true"><i /></div>
            <button type="button" className="mobile-art-toggle" aria-label={mobileCover ? '显示歌词' : '显示封面'} onClick={toggleMobileArt} />
          </div>
          <div className="np-details">
            <div className="np-info">
              <h1>{s.name}</h1>
              <div className="np-meta sub">
                <span>{s.artists.map(a => a.name).join(' / ')}{s.album.name ? ` · ${s.album.name}` : ''}</span>
                {!!currentLyrics?.credits.length && (
                  <details className="song-credits" key={songId}>
                    <summary className="ib" aria-label="制作信息" title="制作信息"><Icon n="info" s={15} /></summary>
                    <ul>{currentLyrics.credits.map((credit, index) => <li key={index}>{credit}</li>)}</ul>
                  </details>
                )}
              </div>
            </div>
            <div className="np-bottom">
              <div className="np-progress">
                <div className="track" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); app.seek(((e.clientX - r.left) / r.width) * (duration || s.duration)); }}><i style={{ width: `${pct}%` }} /></div>
                <div className="times sub sm"><span>{mmss(time)}</span><span className="np-quality">{qualityText}</span><span>{mmss(duration || s.duration)}</span></div>
              </div>
              <div className="ctl">
                <button className="ib" aria-label="上一首" onClick={app.prev}><Icon n="prev" s={22} /></button>
                <button className="ib play" aria-label="播放/暂停" onClick={app.toggle}><Icon n={app.playing ? 'pause' : 'play'} /></button>
                <button className="ib" aria-label="下一首" onClick={app.next}><Icon n="next" s={22} /></button>
                <button className={`ib mode-control ${app.playbackMode !== 'off' ? 'act' : ''}`} aria-label={`切换播放模式，当前${modeLabel}`} onClick={app.cyclePlaybackMode} title={modeLabel}>
                  <Icon n={modeIcon} />{app.playbackMode === 'one' && <span className="mode-count" aria-hidden="true">1</span>}
                </button>
                <span className="np-mobile-queue">{queueButton}</span>
              </div>
              <div className="np-tools">
                {!deviceSong && <button className={`ib heartb ${app.favIds.has(s.id) ? 'on' : ''}`} aria-label="收藏" title="收藏" onClick={() => app.toggleFav(s)}><Icon n="heart" s={18} /></button>}
                {!deviceSong && <button type="button" className="ib" aria-label="下载到设备" title="下载到设备" onClick={() => app.openSave(s)}><Icon n="download" s={18} /></button>}
                {lines.some(line => line.tr) && <button className={`ib ${app.showTr ? 'act' : ''}`} aria-label="歌词翻译" aria-pressed={app.showTr} title="歌词翻译" onClick={() => app.setShowTr(!app.showTr)}><Icon n="translation" s={18} /></button>}
                <span className="np-desktop-queue">{queueButton}</span>
                {!hasRoom && !deviceSong && <button className={`ib ${inviting ? 'act' : ''}`} aria-label="一起听" aria-pressed={inviting} title="一起听" onClick={() => setInviting(open => !open)}><Icon n="users" s={18} /></button>}
              </div>
              <div className="np-audio sub sm">{qualityText}</div>
            </div>
            <div className="np-room">
              {showPlayerContents && <PlayerTogether inviting={inviting && !deviceSong} onClose={() => setInviting(false)} active={activeRoom} />}
              {app.error && <div className="err center" style={{ padding: '8px 0 0' }}>{app.error}</div>}
            </div>
          </div>
        </div>
        <div className="np-stage">
          {showPlayerContents && <PlayerLyrics key={songId} lines={lines} active={active} status={lyricStatus} showTranslation={app.showTr} onSeek={app.seek}
            onBackgroundClick={() => { if (window.matchMedia('(max-width: 860px)').matches) toggleMobileArt(); }} />}
          {showPlayerContents && activeRoom && (
            <div className="together-chat-dock">
              <Conversation compact key={activeRoom.room.id} person={activeRoom.peer} userId={app.me!.id} visible={app.nowOpen} />
            </div>
          )}
        </div>
      </div>
      <FloatingLyrics visible={lyricsPinned && !app.nowOpen} text={currentLine?.text || lyricStatus || '前奏'} translation={app.showTr ? currentLine?.tr : undefined} onClose={onToggleLyrics} />
    </>
  );
}
