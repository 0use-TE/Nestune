'use client';
import { Loading } from './Loading';
import { useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { useApp, useClock } from '@/lib/app';
import { isDeviceSong } from '@/lib/device-music';
import { useSocial } from '@/lib/social';
import type { LyricLine } from '@/lib/types';
import type { Person } from '@/lib/social-types';
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
  const [lyrics, setLyrics] = useState<{ id: string; lines: LyricLine[]; credits: string[]; plainText?: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [mobileCover, setMobileCover] = useState(true);
  const [keepPlayerContents, setKeepPlayerContents] = useState(false);
  const [chatPeer, setChatPeer] = useState<Person | null>(null);
  const [mobilePage, setMobilePage] = useState<'playback' | 'chat'>('playback');
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastSwipe = useRef(0);
  const swipeFrame = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current); }, []);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const move = (event: TouchEvent) => {
      const start = swipe.current;
      if (!start || event.touches.length !== 1) { swipe.current = null; return; }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && event.cancelable) event.preventDefault();
    };
    node.addEventListener('touchmove', move, { passive: false });
    return () => node.removeEventListener('touchmove', move);
  }, [songId]);
  const showPlayerContents = app.nowOpen || keepPlayerContents;
  const hasRoom = !!social.state?.rooms.length;
  const room = social.state?.rooms.find(item => item.active && item.onThisDevice);
  const partner = room && social.state?.people.find(person => person.id === (room.hostId === app.me?.id ? room.guestId : room.hostId));
  const activeRoom = room && partner ? { room, peer: partner } : null;
  const pendingRoom = social.state?.rooms.find(item => !item.active && item.guestId === app.me?.id) ?? social.state?.rooms.find(item => !item.active);
  const pendingPeer = pendingRoom && social.state?.people.find(person => person.id === (pendingRoom.hostId === app.me?.id ? pendingRoom.guestId : pendingRoom.hostId));
  const conversationPeer = partner || pendingPeer || chatPeer;
  useEffect(() => {
    if (partner || pendingPeer) setChatPeer(partner || pendingPeer || null);
  }, [partner, pendingPeer]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 860px)');
    const reset = () => { if (!query.matches) setMobilePage('playback'); };
    query.addEventListener('change', reset);
    return () => query.removeEventListener('change', reset);
  }, []);
  const needsLyrics = app.nowOpen || lyricsPinned;
  const getDeviceLyrics = app.deviceMusic.getLyrics;

  useEffect(() => {
    if (!app.nowOpen) { setChatPeer(null); setMobilePage('playback'); }
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
    if (!songId || !needsLyrics) return;
    let live = true;
    const request: Promise<{ lines: LyricLine[]; credits?: string[]; plainText?: string }> =
      deviceSong ? getDeviceLyrics(songId) : get(`/api/songs/${songId}/lyrics`);
    request.then(({ lines, credits = [], plainText }) => {
      if (!live) return;
      let first = 0;
      let end = lines.length;
      while (first < end && CREDIT.test(lines[first].text)) first++;
      while (end > first && CREDIT.test(lines[end - 1].text)) end--;
      setLyrics({ id: songId, lines: lines.slice(first, end), plainText, credits: [...credits, ...[...lines.slice(0, first), ...lines.slice(end)].map(line => line.text)] });
    }).catch(() => { if (live) setLyrics({ id: songId, lines: [], credits: [] }); });
    return () => { live = false; };
  }, [songId, deviceSong, getDeviceLyrics, needsLyrics]);

  const currentLyrics = lyrics?.id === songId ? lyrics : null;
  const lines = currentLyrics?.lines ?? [];
  let active = -1;
  for (let i = 0; i < lines.length && lines[i].t <= time; i++) active = i;
  const currentLine = lines[active];
  const lyricStatus = !currentLyrics ? <Loading inline label="正在加载歌词" /> : !lines.length && !currentLyrics.plainText ? '暂无歌词' : '';

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
    : deviceSong ? '设备本地播放' : s.uploader ? '原始音质' : '在线播放';
  const songDetails = [s.artists.map(a => a.name).join(' / '), s.album.name, s.uploader && `由 ${s.uploader.name} 上传`].filter(Boolean).join(' · ');
  const toggleMobileArt = () => setMobileCover(cover => !cover);
  const qualityText = audioLabel;
  const queueButton = (
    <button className={`ib queue-toggle ${queueOpen ? 'act' : ''}`} aria-label="播放列表" aria-expanded={queueOpen}
      aria-controls={queueOpen ? 'player-queue' : undefined} title="播放列表" onClick={onToggleQueue}><Icon n="list" s={22} /></button>
  );

  return (
    <>
      <div id="np" ref={panel} className={app.nowOpen ? 'open' : ''} inert={!app.nowOpen} data-mobile-page={mobilePage} data-has-chat={!!conversationPeer || undefined} data-mobile-cover={mobileCover || undefined} data-playing={app.playing || undefined}
        onTouchStart={event => {
          const target = event.target as HTMLElement;
          if (!conversationPeer || !window.matchMedia('(max-width: 860px)').matches || event.touches.length !== 1 || target.closest('input,textarea,button:not(.mobile-art-toggle):not(.ln),.track,.chat-song-picker')) { swipe.current = null; return; }
          swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }} onTouchCancel={() => { swipe.current = null; }} onTouchEnd={event => {
          const start = swipe.current; swipe.current = null;
          if (!start || !event.changedTouches.length || event.touches.length) return;
          const dx = event.changedTouches[0].clientX - start.x;
          const dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            lastSwipe.current = Date.now();
            // Let the native touch finish before hiding its original target.
            if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current);
            swipeFrame.current = requestAnimationFrame(() => {
              swipeFrame.current = null;
              setMobilePage(dx < 0 ? 'chat' : 'playback');
            });
          }
        }} onClickCapture={event => {
          if (event.detail && Date.now() - lastSwipe.current < 400) { event.preventDefault(); event.stopPropagation(); }
        }}>
        {showPlayerContents && s.cover && <div className="np-mobile-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(s.cover)})` }} />}
        <button className="ib close" aria-label="收起" onClick={() => app.setNowOpen(false)}><Icon n="down" s={24} /></button>
        {conversationPeer && <div className="np-page-tabs" role="tablist" aria-label="播放与聊天" onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const page = event.key === 'ArrowRight' ? 'chat' : 'playback';
          setMobilePage(page);
          document.getElementById(`np-tab-${page}`)?.focus();
        }}>
          <button id="np-tab-playback" role="tab" aria-selected={mobilePage === 'playback'} aria-controls="np-playback-page" tabIndex={mobilePage === 'playback' ? 0 : -1} onClick={() => setMobilePage('playback')}>播放</button>
          <button id="np-tab-chat" role="tab" aria-selected={mobilePage === 'chat'} aria-controls="np-chat-page" tabIndex={mobilePage === 'chat' ? 0 : -1} onClick={() => setMobilePage('chat')}>聊天</button>
        </div>}
        <div id="np-playback-page" className="np-playback-page">
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
                <span>{songDetails}</span>
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
                <button className="ib play" aria-busy={app.loading} aria-label="播放/暂停" onClick={app.toggle}>{app.loading ? <Loading inline label="正在缓冲歌曲" /> : <Icon n={app.playing ? 'pause' : 'play'} />}</button>
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
          {showPlayerContents && <PlayerLyrics key={songId} lines={lines} active={active} status={lyricStatus} plainText={currentLyrics?.plainText} showTranslation={app.showTr} onSeek={app.seek}
            onBackgroundClick={() => { if (window.matchMedia('(max-width: 860px)').matches) toggleMobileArt(); }} />}
          {showPlayerContents && activeRoom && (
            <div className="together-chat-dock">
              <Conversation compact key={activeRoom.room.id} person={activeRoom.peer} userId={app.me!.id} visible={app.nowOpen} />
            </div>
          )}
        </div>
        </div>
        {showPlayerContents && conversationPeer && <div id="np-chat-page" className="np-chat-page" role="tabpanel" aria-labelledby="np-tab-chat">
          <Conversation key={conversationPeer.id} person={conversationPeer} userId={app.me!.id} visible={app.nowOpen && mobilePage === 'chat'} />
        </div>}
      </div>
      <FloatingLyrics visible={lyricsPinned && !app.nowOpen} text={currentLine?.text || lyricStatus || currentLyrics?.plainText?.split('\n')[0] || '前奏'} translation={app.showTr ? currentLine?.tr : undefined} onClose={onToggleLyrics} />
    </>
  );
}
