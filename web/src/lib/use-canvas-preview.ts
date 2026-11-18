'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './app';
import { api } from './api';
import type { CanvasRecord } from './canvas-types';

export function useCanvasPreview() {
  const app = useApp(), live = useRef(app); live.current = app;
  const [active, setActive] = useState<{ id: string; loading: boolean; label: string } | null>(null);
  const session = useRef<{ id: string; audio: HTMLAudioElement; resume: () => void; timer?: ReturnType<typeof setTimeout>; abort: AbortController } | null>(null);
  const cleanup = useCallback((resume: boolean) => {
    const old = session.current; session.current = null;
    if (old) { old.abort.abort(); clearTimeout(old.timer); old.audio.pause(); old.audio.removeAttribute('src'); old.audio.load(); if (resume) old.resume(); }
    setActive(null);
  }, []);
  const stop = useCallback(() => cleanup(true), [cleanup]);
  const play = useCallback(async (item: CanvasRecord, toggle = true) => {
    if (session.current?.id === item.id) { if (toggle) stop(); return; }
    const previous = session.current;
    cleanup(false);
    // A room's shared transport is controlled by its participants. Audition never changes it.
    if (live.current.sharedQueue) { previous?.resume(); live.current.toast('一起听时请先退出共同播放，再试听画布'); return; }
    const tracks = (item.tracks ?? [item.song]).filter(song => song.access?.playable !== false);
    if (!tracks.length) { previous?.resume(); live.current.toast('这里暂时没有可试听的歌曲'); return; }
    const song = tracks[Math.floor(Math.random() * tracks.length)], audio = new Audio();
    audio.preload = 'auto'; audio.volume = live.current.volume;
    const current = { id: item.id, audio, resume: previous?.resume ?? live.current.suspendForPreview(), abort: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
    session.current = current; setActive({ id: item.id, loading: true, label: '正在准备试听' });
    const valid = () => session.current === current;
    // A user resuming the main player always wins over an audition.
    current.timer = setTimeout(() => { if (valid()) { stop(); live.current.toast('试听加载超时，请稍后再试'); } }, 25_000);
    // Start a muted load inside the user's pointer gesture, including on mobile browsers.
    audio.muted = true;
    audio.src = `/api/songs/${song.id}/stream?level=standard&prefer=${live.current.sourcePreference}`;
    const unlocked = audio.play().then(() => null, error => error as Error);
    try {
      const preview = await api<{ start: number; end: number; method: string }>(`/api/songs/${song.id}/preview`, { signal: current.abort.signal });
      if (!valid()) return;
      const playError = await unlocked;
      if (!valid()) return;
      if (playError) throw playError;
      const start = Math.min(preview.start, Math.max(0, audio.duration - 1));
      if (Math.abs(audio.currentTime - start) > .05) {
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener('seeked', () => resolve(), { once: true, signal: current.abort.signal });
          current.abort.signal.addEventListener('abort', () => reject(new DOMException('已取消试听', 'AbortError')), { once: true });
          audio.currentTime = start;
        });
      }
      if (!valid()) return;
      audio.muted = false;
      audio.addEventListener('timeupdate', () => { if (valid() && audio.currentTime >= preview.end) stop(); });
      audio.addEventListener('ended', () => { if (valid()) stop(); });
      audio.addEventListener('error', () => { if (valid()) { stop(); live.current.toast('这首歌暂时无法试听，请检查音源权限'); } });
      clearTimeout(current.timer); current.timer = setTimeout(stop, 17_000);
      setActive({ id: item.id, loading: false, label: `${preview.method === 'chorus' ? '副歌试听' : '片段试听'} · ${song.name}` });
    } catch (error) { if (valid()) { stop(); live.current.toast(error instanceof Error ? error.message : '暂时无法试听'); } }
  }, [stop, cleanup]);
  useEffect(() => { if (session.current) session.current.audio.volume = app.volume; }, [app.volume]);
  useEffect(() => { if (app.sharedQueue) stop(); }, [app.sharedQueue, stop]);
  useEffect(() => { if (app.playing && session.current && !session.current.audio.paused) stop(); }, [app.playing, stop]);
  useEffect(() => { const hide = () => { if (document.hidden) stop(); }; document.addEventListener('visibilitychange', hide); return () => { document.removeEventListener('visibilitychange', hide); stop(); }; }, [stop]);
  return { active, play, stop };
}
