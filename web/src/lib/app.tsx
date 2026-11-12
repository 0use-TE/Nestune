'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { del, get, post, put } from './api';
import { isDeviceSong, useDeviceMusic } from './device-music';
import type { Me, PlaylistLite, Song } from './types';
import { loadTint, seededTint } from './util';

/* ---------- playback clock (kept out of React context so ticks do not re-render the app) ---------- */
type Clock = { time: number; duration: number };
let clock: Clock = { time: 0, duration: 0 };
const subs = new Set<() => void>();
const setClock = (time: number, duration: number) => { clock = { time, duration }; subs.forEach(f => f()); };
export const useClock = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => clock, () => clock);

const PLAYBACK_MODES = ['off', 'all', 'one', 'shuffle'] as const;
type PlaybackMode = (typeof PLAYBACK_MODES)[number];
type Theme = 'auto' | 'light' | 'dark';
type ToastKind = 'message' | 'invite';
type Toast = { id: number; text: string; kind?: ToastKind };

export type AppCtx = {
  ready: boolean; me: Me | null; setMe: (m: Me | null) => void; loadSession: () => Promise<void>; logout: () => Promise<void>;
  favIds: Set<string>; toggleFav: (s: Song) => void;
  deviceMusic: ReturnType<typeof useDeviceMusic>;
  saveDialog: Song | null; openSave: (s: Song) => void; closeSave: () => void;
  audioInfo: { quality?: string; source?: string } | null;
  playlists: PlaylistLite[]; reloadPlaylists: () => Promise<void>;
  queue: Song[]; index: number; current: Song | null; playing: boolean; loading: boolean; error: string | null;
  playbackMode: PlaybackMode; cyclePlaybackMode: () => void;
  play: (songs: Song[], start?: number, mode?: PlaybackMode) => void; toggle: () => void; next: () => void; prev: () => void; seek: (t: number) => void;
  playbackPosition: () => number; followPlayback: (song: Song | null, position: number, playing: boolean) => void; setFollowingRoom: (following: boolean) => void;
  playbackRunning: () => boolean; setRoomTransport: (handler: ((playing?: boolean) => boolean) | null) => void;
  enqueue: (s: Song) => void; playNext: (s: Song) => void; removeFromQueue: (i: number) => void; jumpTo: (i: number) => void;
  nowOpen: boolean; setNowOpen: (v: boolean) => void;
  menu: { song: Song; x: number; y: number } | null; openMenu: (s: Song, e: { clientX: number; clientY: number }) => void; closeMenu: () => void;
  toast: (t: string, kind?: ToastKind) => void; toasts: Toast[];
  theme: Theme; setTheme: (t: Theme) => void; showTr: boolean; setShowTr: (v: boolean) => void;
  tint: [string, string];
};
const Ctx = createContext<AppCtx>(null as never);
export const useApp = () => useContext(Ctx);

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const deviceMusic = useDeviceMusic();
  const { getFile } = deviceMusic;
  const [playlists, setPlaylists] = useState<PlaylistLite[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('off');
  const [nowOpen, setNowOpen] = useState(false);
  const [menu, setMenu] = useState<AppCtx['menu']>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<Theme>('auto');
  const [showTr, setShowTrState] = useState(true);
  const [tint, setTint] = useState<[string, string]>(seededTint('0'));
  const [loadKey, setLoadKey] = useState(0);
  const [saveDialog, setSaveDialog] = useState<Song | null>(null);
  const [audioInfo, setAudioInfo] = useState<{ quality?: string; source?: string } | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const live = useRef({ queue, index, playbackMode, playing });
  live.current = { queue, index, playbackMode, playing };
  const autoplay = useRef(false);
  const recorded = useRef(false);
  const preloaded = useRef(false);
  const pendingSeek = useRef(0);
  const followingRoom = useRef(false);
  const roomTransport = useRef<((playing?: boolean) => boolean) | null>(null);
  const failures = useRef(0);
  const restored = useRef(false);

  const current = index >= 0 ? queue[index] ?? null : null;

  /* ----- toast ----- */
  const toast = useCallback((text: string, kind?: ToastKind) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind ? 3800 : 2200);
  }, []);

  /* ----- preferences ----- */
  useEffect(() => {
    setThemeState(lsGet('nt-theme', 'auto') as Theme);
    setShowTrState(lsGet('nt-tr', '1') === '1');
  }, []);
  useEffect(() => {
    const r = document.documentElement;
    if (theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = theme;
  }, [theme]);
  const setTheme = (t: Theme) => { setThemeState(t); lsSet('nt-theme', t); };
  const setShowTr = (v: boolean) => { setShowTrState(v); lsSet('nt-tr', v ? '1' : '0'); };

  /* ----- session ----- */
  const resetUserState = useCallback(() => {
    audio.current?.pause();
    if (audio.current) audio.current.removeAttribute('src');
    setQueue([]); setIndex(-1); setPlaying(false); setFavIds(new Set()); setPlaylists([]); setNowOpen(false);
    restored.current = false; setClock(0, 0);
  }, []);

  const loadUserData = useCallback(async () => {
    const [f, p, q] = await Promise.allSettled([get('/api/me/favorites'), get('/api/me/playlists'), get('/api/me/queue')]);
    if (f.status === 'fulfilled') setFavIds(new Set(f.value.ids));
    if (p.status === 'fulfilled') setPlaylists(p.value.playlists);
    if (q.status === 'fulfilled' && q.value.songs.length) {
      autoplay.current = false;
      pendingSeek.current = q.value.position || 0;
      setQueue(q.value.songs); setIndex(Math.min(q.value.index, q.value.songs.length - 1)); setLoadKey(k => k + 1);
    }
    restored.current = true;
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const r = await get('/api/me');
      setMe(r.user);
      await loadUserData();
    } catch { setMe(null); }
    setReady(true);
  }, [loadUserData]);

  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => {
    const h = () => { resetUserState(); setMe(null); };
    window.addEventListener('nt:unauthorized', h);
    return () => window.removeEventListener('nt:unauthorized', h);
  }, [resetUserState]);

  const logout = useCallback(async () => {
    try { await post('/api/auth/logout'); } catch { /* ignore */ }
    resetUserState(); setMe(null);
  }, [resetUserState]);

  /* ----- audio element ----- */
  const go = useCallback((n: number) => { autoplay.current = true; pendingSeek.current = 0; setIndex(n); setLoadKey(k => k + 1); }, []);

  const next = useCallback((fromEnded = false) => {
    const { queue: q, index: i, playbackMode: mode } = live.current;
    if (!q.length) return;
    let n: number;
    if (mode === 'shuffle' && q.length > 1) {
      const pick = Math.floor(Math.random() * (q.length - 1));
      n = pick >= i ? pick + 1 : pick;
    }
    else {
      n = i + 1;
      if (n >= q.length) {
        if (mode === 'all' || !fromEnded) n = 0;
        else { const a = audio.current; if (a) { a.pause(); a.currentTime = 0; } setPlaying(false); setClock(0, clock.duration); return; }
      }
    }
    go(n);
  }, [go]);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    audio.current = a;
    const dur = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (live.current.queue[live.current.index]?.duration ?? 0));
    const onTime = () => {
      setClock(a.currentTime, dur());
      const left = dur() - a.currentTime;
      if (!preloaded.current && left > 0 && left < 25) {
        preloaded.current = true;
        const { queue: q, index: i } = live.current;
        const nx = q[(i + 1) % q.length];
        if (nx && !isDeviceSong(nx.id) && nx.id !== q[i]?.id) fetch(`/api/songs/${nx.id}/stream`, { headers: { Range: 'bytes=0-1' } }).catch(() => {});
      }
    };
    const onPlaying = () => {
      setPlaying(true); setLoading(false); failures.current = 0;
      if (!recorded.current) {
        recorded.current = true;
        const s = live.current.queue[live.current.index];
        if (s && !isDeviceSong(s.id)) post('/api/me/history', { songId: s.id }).catch(() => {});
      }
    };
    const onMeta = () => {
      const duration = dur();
      if (pendingSeek.current > 0 && pendingSeek.current < duration) a.currentTime = pendingSeek.current;
      pendingSeek.current = 0;
      setClock(a.currentTime, duration);
    };
    const onErr = () => {
      if (!a.getAttribute('src')) return;
      setLoading(false); setPlaying(false);
      failures.current++;
      setError(e => e || '这首歌暂时无法播放');
      const { queue: q } = live.current;
      if (failures.current < Math.min(3, q.length) && q.length > 1) setTimeout(() => next(true), 800);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', () => { if (!a.ended) setPlaying(false); });
    a.addEventListener('waiting', () => setLoading(true));
    a.addEventListener('canplay', () => setLoading(false));
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', () => {
      if (followingRoom.current) { setPlaying(false); return; }
      if (live.current.playbackMode === 'one') { a.currentTime = 0; a.play().catch(() => {}); } else next(true);
    });
    a.addEventListener('error', onErr);
    return () => { a.pause(); a.removeAttribute('src'); };
  }, [next]);

  // load the current song whenever the track (or an explicit reload) changes
  useEffect(() => {
    const a = audio.current;
    if (!a || !current) return;
    setError(null); recorded.current = false; preloaded.current = false; setLoading(autoplay.current);
    setAudioInfo(null);
    setClock(0, current.duration);
    if (isDeviceSong(current.id)) {
      let live = true;
      let source: string | undefined;
      const shouldPlay = autoplay.current;
      a.pause();
      a.removeAttribute('src');
      getFile(current.id).then(file => {
        if (!live) return;
        if (!file.size) throw Error('此音乐文件为空');
        source = URL.createObjectURL(file);
        a.src = source;
        setAudioInfo({ source: 'device' });
        if (shouldPlay) return a.play();
      }).catch(error => {
        if (live) {
          setLoading(false);
          setPlaying(false);
          setError(error instanceof Error ? error.message : '无法播放此设备上的歌曲');
        }
      });
      return () => { live = false; if (source) URL.revokeObjectURL(source); };
    }
    a.src = `/api/songs/${current.id}/stream`;
    const sid = current.id;
    fetch(`/api/songs/${sid}/stream`, { headers: { Range: 'bytes=0-0' } }).then(async r => {
      if (live.current.queue[live.current.index]?.id !== sid) return;
      if (r.ok) setAudioInfo({ quality: r.headers.get('x-audio-quality') || undefined, source: r.headers.get('x-audio-source') || undefined });
      else { const j = await r.json().catch(() => ({})); if (j.error) { setError(j.error); setLoading(false); } }
    }).catch(() => {});
    if (autoplay.current) a.play().catch(() => { setLoading(false); setPlaying(false); });
    else setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, current?.id, getFile]);

  // tint follows the cover
  useEffect(() => {
    let live = true;
    loadTint(current?.cover, current?.id ?? '0').then(t => { if (live) { setTint(t); const r = document.documentElement.style; r.setProperty('--c1', t[0]); r.setProperty('--c2', t[1]); } });
    return () => { live = false; };
  }, [current?.id, current?.cover]);

  // lock-screen / media-key integration
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name, artist: current.artists.map(a => a.name).join(' / '), album: current.album.name,
      artwork: current.cover ? [{ src: current.cover, sizes: '400x400' }] : [],
    });
  }, [current]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (!roomTransport.current?.(true)) audio.current?.play().catch(() => {}); });
    ms.setActionHandler('pause', () => { if (!roomTransport.current?.(false)) audio.current?.pause(); });
    ms.setActionHandler('previoustrack', () => prevRef.current());
    ms.setActionHandler('nexttrack', () => next());
    ms.setActionHandler('seekto', d => { if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime; });
    ms.playbackState = playing ? 'playing' : 'paused';
  }, [playing, next]);

  // remember the queue between visits
  useEffect(() => {
    if (!me || !restored.current || followingRoom.current) return;
    if (queue[index] && isDeviceSong(queue[index].id)) return;
    const onlineIds = queue.filter(song => !isDeviceSong(song.id)).slice(0, 500).map(song => song.id);
    const onlineIndex = queue.slice(0, Math.max(0, index)).filter(song => !isDeviceSong(song.id)).length;
    const t = setTimeout(() => {
      if (followingRoom.current) return;
      put('/api/me/queue', { ids: onlineIds, index: onlineIndex, position: Math.floor(audio.current?.currentTime || 0) }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [queue, index, me]);

  /* ----- controls ----- */
  const play = useCallback((all: Song[], start = 0, mode?: PlaybackMode) => {
    const songs = all.filter(s => s.access?.playable !== false);
    if (!songs.length) { toast(all[0]?.access?.reason || '这些歌曲暂时都无法播放'); return; }
    const target = all[Math.max(0, Math.min(start, all.length - 1))];
    const at = mode === 'shuffle' ? Math.floor(Math.random() * songs.length) : Math.max(0, songs.findIndex(s => s.id === target?.id));
    if (mode) setPlaybackMode(mode);
    autoplay.current = true; pendingSeek.current = 0;
    setQueue(songs); setIndex(at); setLoadKey(k => k + 1);
  }, [toast]);
  const toggle = useCallback(() => {
    if (roomTransport.current?.()) return;
    const a = audio.current;
    if (!a || !live.current.queue.length) return;
    if (!a.getAttribute('src') || a.error) { autoplay.current = true; setLoadKey(k => k + 1); return; }
    if (a.paused) { setError(null); a.play().catch(() => {}); } else a.pause();
  }, []);
  const prev = useCallback(() => {
    const a = audio.current, { queue: q, index: i } = live.current;
    if (!a || !q.length) return;
    if (a.currentTime > 3) { a.currentTime = 0; return; }
    go(i > 0 ? i - 1 : q.length - 1);
  }, [go]);
  const prevRef = useRef(prev); prevRef.current = prev;
  const seek = useCallback((t: number) => { const a = audio.current; if (a) { a.currentTime = Math.max(0, t); setClock(a.currentTime, clock.duration); } }, []);
  const playbackPosition = useCallback(() => audio.current?.currentTime || 0, []);
  const playbackRunning = useCallback(() => !!audio.current && !audio.current.paused && !audio.current.ended && audio.current.readyState >= 2, []);
  const setRoomTransport = useCallback((handler: ((playing?: boolean) => boolean) | null) => { roomTransport.current = handler; }, []);
  const setFollowingRoom = useCallback((following: boolean) => { followingRoom.current = following; }, []);
  const followPlayback = useCallback((song: Song | null, position: number, shouldPlay: boolean) => {
    const a = audio.current;
    if (!a) return;
    if (!song) { a.pause(); return; }
    const target = song.duration ? Math.min(position, Math.max(0, song.duration - 0.1)) : position;
    const { queue: currentQueue, index: currentIndex } = live.current;
    if (currentQueue[currentIndex]?.id !== song.id) {
      autoplay.current = shouldPlay;
      pendingSeek.current = target;
      setQueue([song]); setIndex(0); setLoadKey(key => key + 1);
      return;
    }
    if (a.error) return;
    if (a.readyState < 1) pendingSeek.current = target;
    else if (Math.abs(a.currentTime - target) > (shouldPlay ? 1.2 : 0.3)) {
      a.currentTime = target;
      setClock(a.currentTime, clock.duration);
    }
    if (shouldPlay && a.paused && !a.ended) a.play().catch(() => {});
    if (!shouldPlay && !a.paused) a.pause();
  }, []);
  const enqueue = useCallback((s: Song) => {
    if (s.access?.playable === false) { toast(s.access.reason || '这首歌暂时无法播放'); return; }
    if (!live.current.queue.length) { autoplay.current = false; setQueue([s]); setIndex(0); setLoadKey(k => k + 1); }
    else setQueue(q => [...q, s]);
    toast('已加入播放队列');
  }, [toast]);
  const playNext = useCallback((s: Song) => {
    if (s.access?.playable === false) { toast(s.access.reason || '这首歌暂时无法播放'); return; }
    if (!live.current.queue.length) { play([s]); return; }
    setQueue(q => { const i = live.current.index; const c = q.slice(); c.splice(i + 1, 0, s); return c; });
    toast('将在下一首播放');
  }, [play, toast]);
  const removeFromQueue = useCallback((i: number) => {
    const { queue: q, index: cur } = live.current;
    if (i === cur) {
      const rest = q.filter((_, k) => k !== i);
      if (!rest.length) { resetUserStatePlayer(); return; }
      setQueue(rest); autoplay.current = live.current.playing; setIndex(Math.min(i, rest.length - 1)); setLoadKey(k => k + 1);
    } else { setQueue(q.filter((_, k) => k !== i)); if (i < cur) setIndex(cur - 1); }
    function resetUserStatePlayer() { audio.current?.pause(); audio.current?.removeAttribute('src'); setQueue([]); setIndex(-1); setPlaying(false); setClock(0, 0); }
  }, []);

  /* ----- favourites ----- */
  const toggleFav = useCallback((s: Song) => {
    if (isDeviceSong(s.id)) return;
    const had = favIds.has(s.id);
    setFavIds(prevSet => { const n = new Set(prevSet); if (had) n.delete(s.id); else n.add(s.id); return n; });
    (had ? del(`/api/me/favorites/${s.id}`) : put(`/api/me/favorites/${s.id}`)).catch(e => {
      setFavIds(prevSet => { const n = new Set(prevSet); if (had) n.add(s.id); else n.delete(s.id); return n; });
      toast(e.message);
    });
  }, [favIds, toast]);
  const reloadPlaylists = useCallback(async () => { try { setPlaylists((await get('/api/me/playlists')).playlists); } catch { /* ignore */ } }, []);

  const value: AppCtx = useMemo(() => ({
    ready, me, setMe, loadSession, logout, favIds, toggleFav, deviceMusic, playlists, reloadPlaylists,
    saveDialog, openSave: (s: Song) => setSaveDialog(s), closeSave: () => setSaveDialog(null), audioInfo,
    queue, index, current, playing, loading, error, playbackMode,
    play, toggle, next: () => next(), prev, seek, playbackPosition, playbackRunning, followPlayback, setFollowingRoom, setRoomTransport,
    cyclePlaybackMode: () => setPlaybackMode(mode => PLAYBACK_MODES[(PLAYBACK_MODES.indexOf(mode) + 1) % PLAYBACK_MODES.length]),
    enqueue, playNext, removeFromQueue, jumpTo: go,
    nowOpen, setNowOpen, menu, openMenu: (song, e) => setMenu({ song, x: e.clientX, y: e.clientY }), closeMenu: () => setMenu(null),
    toast, toasts, theme, setTheme, showTr, setShowTr, tint,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, me, favIds, deviceMusic, playlists, saveDialog, audioInfo, queue, index, current, playing, loading, error, playbackMode, nowOpen, menu, toasts, theme, showTr, tint, toggleFav, play, toggle, prev, seek, playbackPosition, playbackRunning, followPlayback, setFollowingRoom, setRoomTransport, enqueue, playNext, removeFromQueue, go, toast, next, logout, loadSession, reloadPlaylists]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
