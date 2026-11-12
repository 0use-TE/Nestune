'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, post } from './api';
import { useApp } from './app';
import { isDeviceSong } from './device-music';
import type { ListeningRoom, SocialState } from './social-types';
import type { Song } from './types';

const NOTICE_DEFAULTS = { messageToast: true, messageSound: false, inviteToast: true };
type Notices = typeof NOTICE_DEFAULTS;
type SocialContext = {
  state: SocialState | null;
  error: string;
  playbackError: string;
  action: (data: Record<string, unknown>) => Promise<SocialState>;
  notices: Notices;
  setNotice: (key: keyof Notices, value: boolean) => void;
};
const Context = createContext<SocialContext | null>(null);
export const useOptionalSocial = () => useContext(Context);
export const useSocial = () => useContext(Context)!;

export function SocialProvider({ children }: { children: ReactNode }) {
  const userId = useApp().me?.id;
  return userId ? <SocialSession key={userId} userId={userId}>{children}</SocialSession> : children;
}

function SocialSession({ userId, children }: { userId: number; children: ReactNode }) {
  const app = useApp();
  const { setFollowingRoom, followPlayback, setRoomTransport } = app;
  const player = useRef(app);
  player.current = app;
  const latest = useRef<SocialState | null>(null);
  const receivedAt = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const applied = useRef<{ id: number; version: number } | null>(null);
  const openedRoom = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const noticeRef = useRef(NOTICE_DEFAULTS);
  const [notices, setNotices] = useState(NOTICE_DEFAULTS);
  const [state, setState] = useState<SocialState | null>(null);
  const [error, setError] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [sharedSong, setSharedSong] = useState<Song | null>(null);

  useEffect(() => {
    mounted.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem('nt-notices:' + userId) || '{}');
      const restored = { messageToast: stored.messageToast !== false, messageSound: stored.messageSound === true, inviteToast: stored.inviteToast !== false };
      noticeRef.current = restored; setNotices(restored);
    } catch { /* storage unavailable */ }
    return () => { mounted.current = false; audio.current?.close().catch(() => {}); audio.current = null; };
  }, [userId]);

  const enableSound = useCallback(() => {
    if (!noticeRef.current.messageSound || typeof AudioContext === 'undefined') return;
    try {
      audio.current ??= new AudioContext();
      if (audio.current.state === 'suspended') audio.current.resume().catch(() => {});
    } catch { /* browser audio unavailable */ }
  }, []);

  useEffect(() => {
    window.addEventListener('pointerdown', enableSound);
    window.addEventListener('keydown', enableSound);
    return () => { window.removeEventListener('pointerdown', enableSound); window.removeEventListener('keydown', enableSound); };
  }, [enableSound]);

  function setNotice(key: keyof Notices, value: boolean) {
    const next = { ...noticeRef.current, [key]: value };
    noticeRef.current = next; setNotices(next);
    try { localStorage.setItem('nt-notices:' + userId, JSON.stringify(next)); } catch { /* storage unavailable */ }
    if (key === 'messageSound' && value) enableSound();
  }

  const action = useCallback((data: Record<string, unknown>) => {
    const request = chain.current.then(async () => {
      if (!mounted.current) throw new Error('当前会话已结束');
      const next = await post<SocialState>('/api/social', data);
      if (!mounted.current) return next;
      const previous = latest.current;
      const options = noticeRef.current;
      if (previous) {
        const incoming = new Map(previous.inbox?.map(item => [item.peerId, item.latestIncomingId]));
        const fresh = next.inbox?.filter(item => item.unread && item.latestIncomingId > (incoming.get(item.peerId) ?? 0)) ?? [];
        if (fresh.length) {
          const person = next.people.find(item => item.id === fresh[0].peerId);
          if (options.messageToast) player.current.toast(fresh.length === 1 ? (person?.name ?? '好友') + ' 发来新消息' : '有 ' + fresh.length + ' 个聊天收到新消息', 'message');
          if (options.messageSound && audio.current?.state === 'running') playNotice(audio.current);
        }
        const existing = new Set(previous.rooms.map(room => room.id));
        const invite = next.rooms.find(room => !room.active && room.guestId === userId && !existing.has(room.id));
        if (invite && options.inviteToast) player.current.toast((next.people.find(person => person.id === invite.hostId)?.name ?? '好友') + ' 邀请你一起听', 'invite');
      }
      if (data.action === 'invite' && options.inviteToast) player.current.toast('一起听邀请已发送', 'invite');
      receivedAt.current = Date.now();
      latest.current = next;
      setState(next);
      setError('');
      return next;
    });
    chain.current = request.catch(() => {});
    return request;
  }, [userId]);

  useEffect(() => {
    setRoomTransport(playing => {
      const room = latest.current?.rooms.find(item => item.active && item.onThisDevice);
      if (!room?.playback || room.playback.songId !== player.current.current?.id) return false;
      action({ action: 'roomPlayback', roomId: room.id, songId: room.playback.songId, playing })
        .catch(e => player.current.toast(e instanceof Error ? e.message : '无法切换播放状态'));
      return true;
    });
    return () => setRoomTransport(null);
  }, [action, setRoomTransport]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function pulse() {
      const current = player.current;
      const room = latest.current?.rooms.find(item => item.active && item.onThisDevice);
      const hostCanPublish = room?.hostId === userId && (room.transportVersion === 0 ||
        (applied.current?.id === room.id && applied.current.version === room.transportVersion));
      const song = current.current && !isDeviceSong(current.current.id) ? current.current : null;
      const playing = current.playing && !current.loading;
      const name = song?.name.trim().slice(0, 160);
      try {
        await action({
          action: 'sync',
          track: playing && song && name ? { id: song.id, name, artist: song.artists.map(a => a.name).join(' / ').slice(0, 160) } : null,
          roomId: hostCanPublish ? room.id : undefined,
          transportVersion: hostCanPublish ? room.transportVersion : undefined,
          playback: hostCanPublish && song ? { songId: song.id, position: current.playbackPosition(), playing: current.playbackRunning() } : null,
        });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : '暂时无法连接');
      } finally {
        if (live) timer = setTimeout(pulse, latest.current?.rooms.some(item => item.active && item.onThisDevice) ? 1700 : 5000);
      }
    }
    pulse();
    return () => { live = false; clearTimeout(timer); };
  }, [action, userId]);

  const activeRoom = state?.rooms.find(room => room.active && room.onThisDevice);
  useEffect(() => {
    if (!activeRoom || !app.current || openedRoom.current === activeRoom.id) return;
    if (activeRoom.guestId === userId && activeRoom.playback?.songId !== app.current.id) return;
    openedRoom.current = activeRoom.id;
    app.setNowOpen(true);
  }, [activeRoom, app.current, app.setNowOpen, userId]);
  const guestRoom = activeRoom?.guestId === userId ? activeRoom : undefined;
  const songId = guestRoom?.playback?.songId;
  const following = !!guestRoom;
  useEffect(() => {
    setFollowingRoom(following);
    return () => setFollowingRoom(false);
  }, [following, setFollowingRoom]);

  useEffect(() => {
    setPlaybackError('');
    if (!songId) { setSharedSong(null); return; }
    let live = true;
    get<{ song: Song }>('/api/songs/' + songId).then(({ song }) => {
      if (!live) return;
      if (song.access?.playable === false) setPlaybackError(song.access.reason || '你的账号暂时无法播放这首歌');
      else setSharedSong(song);
    }).catch(e => { if (live) setPlaybackError(e.message); });
    return () => { live = false; };
  }, [songId]);

  useEffect(() => {
    if (!guestRoom || !state) return;
    const playback = guestRoom.playback;
    if (!playback || sharedSong?.id !== playback.songId) { followPlayback(null, 0, false); return; }
    followPlayback(sharedSong, roomPosition(guestRoom, state.serverTime, receivedAt.current), playback.playing);
  }, [state, guestRoom, sharedSong, followPlayback]);

  useEffect(() => {
    if (!state || !activeRoom || activeRoom.hostId !== userId || !activeRoom.transportVersion || !activeRoom.playback) return;
    if (applied.current?.id === activeRoom.id && applied.current.version === activeRoom.transportVersion) return;
    const song = player.current.current;
    if (song?.id === activeRoom.playback.songId) followPlayback(song, roomPosition(activeRoom, state.serverTime, receivedAt.current), activeRoom.playback.playing);
    applied.current = { id: activeRoom.id, version: activeRoom.transportVersion };
  }, [state, activeRoom, userId, followPlayback]);

  return <Context.Provider value={{ state, error, playbackError, action, notices, setNotice }}>{children}</Context.Provider>;
}

function roomPosition(room: ListeningRoom, serverTime: number, receivedAt: number) {
  const elapsed = room.playback?.playing ? Math.max(0, serverTime - room.updatedAt + Date.now() - receivedAt) / 1000 : 0;
  return (room.playback?.position ?? 0) + elapsed;
}

function playNotice(context: AudioContext) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;
  oscillator.frequency.setValueAtTime(660, start);
  oscillator.frequency.setValueAtTime(880, start + .075);
  gain.gain.setValueAtTime(.001, start);
  gain.gain.linearRampToValueAtTime(.085, start + .025);
  gain.gain.exponentialRampToValueAtTime(.001, start + .18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + .19);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
