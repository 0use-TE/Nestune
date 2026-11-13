'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, post } from './api';
import { usePathname } from 'next/navigation';
import { useApp } from './app';
import { isDeviceSong } from './device-music';
import type { ListeningRoom, Person, SocialState, SocialUpdate } from './social-types';

const NOTICE_DEFAULTS = { messageToast: true, messageSound: false, inviteToast: true };
type Notices = typeof NOTICE_DEFAULTS;
type SocialContext = {
  state: SocialState | null;
  directory: Person[] | null;
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
  const path = usePathname();
  const pathRef = useRef(path); pathRef.current = path;
  const [directory, setDirectory] = useState<Person[] | null>(null);
  const { setFollowingRoom, setRoomTransport, beginSharedQueue, endSharedQueue, applyRoomQueue, setRoomQueueHandler } = app;
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
      const previous = latest.current;
      const payload = data.action === 'sync' ? { ...data, known: {
        peopleVersion: previous?.peopleVersion,
        queues: Object.fromEntries(previous?.rooms.filter(room => room.queue).map(room => [room.id, room.transportVersion]) ?? []),
      } } : data;
      const update = await post<SocialUpdate>('/api/social', payload);
      const next: SocialState = { ...update, people: update.people ?? previous?.people ?? [], rooms: update.rooms.map(room => {
        const old = previous?.rooms.find(item => item.id === room.id);
        return { ...room, queue: room.queueUnchanged && old?.transportVersion === room.transportVersion ? old.queue : room.queue };
      }) };
      if (!mounted.current) return next;
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
      setState(next); setDirectory(next.people);
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
    let running = false;
    let bootstrapped = false;
    async function pulse() {
      if (!live || running) return;
      clearTimeout(timer);
      if (document.hidden && !latest.current?.rooms.some(room => room.active && room.onThisDevice)) return;
      running = true;
      const current = player.current;
      const room = latest.current?.rooms.find(item => item.active && item.onThisDevice);
      const seed = room?.hostId === userId && !room.queue ? current.queueSeed() : undefined;
      const hostCanPublish = room?.hostId === userId && !current.loading && (room.transportVersion === 0 ||
        (applied.current?.id === room.id && applied.current.version === room.transportVersion));
      const song = current.current && !isDeviceSong(current.current.id) ? current.current : null;
      const playing = current.playing && !current.loading;
      const name = song?.name.trim().slice(0, 160);
      try {
        await action({
          action: 'sync',
          track: playing && song && name ? { id: song.id, name, artist: song.artists.map(a => a.name).join(' / ').slice(0, 160) } : null,
          roomId: hostCanPublish || seed ? room!.id : undefined,
          seed,
          transportVersion: hostCanPublish ? room.transportVersion : undefined,
          playback: hostCanPublish && song ? { songId: song.id, position: current.playbackPosition(), playing: current.playbackRunning() } : null,
        });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : '暂时无法连接');
      } finally {
        running = false;
        if (live) timer = setTimeout(pulse, latest.current?.rooms.some(item => item.active && item.onThisDevice) ? 1700 : pathRef.current === '/social' || pathRef.current === '/chat' ? 5000 : 10000);
      }
    }
    // Show the small user directory before downloading presence, inbox and queues.
    get<{ people: Person[] }>('/api/social?scope=directory').then(data => { if (live && !latest.current) setDirectory(data.people); }).catch(() => {}).finally(() => { bootstrapped = true; if (live) void pulse(); });
    const wake = () => { if (bootstrapped && !document.hidden) void pulse(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('nt:social-refresh', wake);
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('nt:social-refresh', wake); };
  }, [action, userId]);

  useEffect(() => { if (path === '/social' || path === '/chat') window.dispatchEvent(new Event('nt:social-refresh')); }, [path]);

  const activeRoom = state?.rooms.find(room => room.active && room.onThisDevice);
  useEffect(() => {
    if (!activeRoom || !app.current || openedRoom.current === activeRoom.id) return;
    if (activeRoom.guestId === userId && activeRoom.playback?.songId !== app.current.id) return;
    openedRoom.current = activeRoom.id;
    app.setNowOpen(true);
  }, [activeRoom, app.current, app.setNowOpen, userId]);
  useEffect(() => {
    if (!state || !app.ready) return;
    if (!activeRoom) {
      setRoomQueueHandler(null); setFollowingRoom(false); endSharedQueue(); applied.current = null;
      return;
    }
    beginSharedQueue();
    setFollowingRoom(activeRoom.guestId === userId);
    setRoomQueueHandler(command => {
      const current = latest.current?.rooms.find(room => room.active && room.onThisDevice);
      if (!current?.queue) { player.current.toast('共同列表正在准备中'); return; }
      if (command.type === 'next' && command.automatic && current.hostId !== userId) return;
      action({ action: 'roomQueue', roomId: current.id, command: command.type === 'next' && command.automatic ? { ...command, version: current.transportVersion } : command })
        .catch(e => player.current.toast(e instanceof Error ? e.message : '无法更新共同列表'));
    });
    if (!activeRoom.queue) { if (activeRoom.guestId === userId) player.current.followPlayback(null, 0, false); return; }
    const playback = activeRoom.playback;
    if (activeRoom.guestId === userId || applied.current?.id !== activeRoom.id || applied.current.version !== activeRoom.transportVersion) {
      applyRoomQueue(activeRoom.queue, roomPosition(activeRoom, state.serverTime, receivedAt.current), !!playback?.playing);
      applied.current = { id: activeRoom.id, version: activeRoom.transportVersion };
    }
    setPlaybackError('');
    return () => { setRoomQueueHandler(null); };
  }, [state, activeRoom, app.ready, action, userId, beginSharedQueue, endSharedQueue, applyRoomQueue, setFollowingRoom, setRoomQueueHandler]);

  return <Context.Provider value={{ state, directory, error, playbackError, action, notices, setNotice }}>{children}</Context.Provider>;
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
