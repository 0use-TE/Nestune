'use client';
import { Select } from './Select';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasCamera } from '@/lib/use-canvas-camera';
import { CANVAS_DRAG_THRESHOLD, WORLD_LIMIT, type Camera } from '@/lib/canvas-camera';
import { useCanvasPreview } from '@/lib/use-canvas-preview';
import { useCanvasSync } from '@/lib/use-canvas-sync';
import { WALL_TILE_SIZE } from '@/lib/canvas-wall';
import { CanvasWallPainter } from '@/lib/canvas-wall-painter';
import { CANVAS_WALLPAPERS, DEFAULT_CANVAS_SETTINGS } from '@/lib/canvas-settings';
import { api, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { CANVAS_DRAG_TYPE, isCanvasGraffiti, isCanvasMusic, type CanvasItem, type CanvasRecord, type CanvasSource, type CanvasState } from '@/lib/canvas-types';
import type { CollectionFavorite } from '@/lib/collection-types';
import { personalPlaylistPath } from '@/lib/playlist-queue';
import type { Artist, Song } from '@/lib/types';
import { RecordPlayerAudio, RECORD_INSERT_MS } from '@/lib/record-player-audio';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';
import { Sheet } from './Sheet';
import { CanvasGuide } from './CanvasGuide';
import { CanvasGraffiti, type GraffitiEditorHandle } from './CanvasGraffiti';
import { CanvasImage } from './CanvasImage';
import { MAX_GRAFFITI_SIDE, type GraffitiArea, type Point } from '@/lib/canvas-graffiti';

type Drag = { pointer: number; startX: number; startY: number; x: number; y: number; active: boolean; cancelled: boolean; timer: ReturnType<typeof setTimeout>; item: CanvasItem; source?: CanvasSource; size: number };
type Ghost = { item: CanvasItem; x: number; y: number; size: number };
type Insertion = { item: CanvasRecord; x: number; slotY: number; size: number; fromX: number; fromY: number; source?: CanvasSource };
type MusicKind = 'song' | 'album';
type MusicChoice = { source: CanvasSource; subtitle: string };
type PickerResult = { path: string; kind: MusicKind; choices: MusicChoice[]; playlistCover?: string | null; warnings?: string[]; error?: string };
type AlbumSummary = { id: string; name: string; cover: string | null };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const GRAFFITI_MIN_ZOOM = .2;
const EMOJI = ['🎵','🎧','💿','📼','🎸','🎹','❤️','✨','⭐','🌙','☀️','🌈','🌷','🌻','🍀','🍒','☕','🍰','🐱','🐶','🫶','🥹','😎','🤍'];
function sourceItem(source: CanvasSource): CanvasRecord {
  const song = source.previewSong ?? { id: source.songId ?? '', name: source.name, cover: source.cover ?? null, artists: [], duration: 0, album: { id: source.albumId ?? null, name: source.name } };
  return { id: '', ownerId: 0, x: 500, y: 300, rotation: 0, kind: source.kind, name: source.name, song, albumId: source.albumId ?? null };
}
const artistNames = (artists: Artist[]) => artists.map(artist => artist.name).join(' / ');
const songChoice = (song: Song): MusicChoice => ({
  source: { kind: 'song', songId: song.id, name: song.name, cover: song.cover, previewSong: song },
  subtitle: artistNames(song.artists),
});
const albumChoice = (album: AlbumSummary, subtitle: string): MusicChoice => ({
  source: { kind: 'album', albumId: album.id, name: album.name, cover: album.cover },
  subtitle,
});

function playlistChoices(songs: Song[], kind: MusicKind): MusicChoice[] {
  if (kind === 'song') return songs.map(songChoice);
  const albums = new Map<string, MusicChoice>();
  for (const song of songs) {
    const { id, name } = song.album;
    if (id && !albums.has(id)) albums.set(id, albumChoice({ id, name, cover: song.cover }, artistNames(song.artists)));
  }
  return [...albums.values()];
}

export function Square() {
  const app = useApp();
  const preview = useCanvasPreview();
  const audition = useRef(preview); audition.current = preview;
  const live = useRef(app); live.current = app;
  const [state, setState] = useState<CanvasState>({ revision: -1, records: [] });
  const stateRef = useRef(state); stateRef.current = state;
  const [loaded, setLoaded] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [playGuideId, setPlayGuideId] = useState<string | null>(null);
  const playGuideSeen = useRef(false);
  const playGuideKey = `nt-canvas-play-guide-v1:${app.me?.id ?? 'guest'}`;
  const guideKey = `nt-canvas-guide-v1:${app.me?.id ?? 'guest'}`;
  const dismissGuide = useCallback(() => { setShowGuide(false); try { localStorage.setItem(guideKey, '1'); } catch {} }, [guideKey]);
  const dismissPlaybackGuide = useCallback(() => {
    setPlayGuideId(null); playGuideSeen.current = true;
    try { localStorage.setItem(playGuideKey, '1'); } catch {}
  }, [playGuideKey]);
  useEffect(() => {
    setPlayGuideId(null);
    try { setShowGuide(localStorage.getItem(guideKey) !== '1'); playGuideSeen.current = localStorage.getItem(playGuideKey) === '1'; }
    catch { setShowGuide(true); playGuideSeen.current = false; }
  }, [guideKey, playGuideKey]);
  const [picker, setPicker] = useState(false);
  const [tools, setTools] = useState(false);
  const [note, setNote] = useState<{ text: string; color: string; captureMoment: boolean } | null>(null);
  const [graffiti, setGraffiti] = useState<GraffitiArea | null>(null);
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [collection, setCollection] = useState('favorites');
  const [albumCollection, setAlbumCollection] = useState('saved');
  const [kind, setKind] = useState<MusicKind>('song');
  const [online, setOnline] = useState(false);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [pickerResult, setPickerResult] = useState<PickerResult | null>(null);
  const [pickerRetry, setPickerRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [nativeSource, setNativeSource] = useState<CanvasSource | null>(null);
  const nativeRef = useRef<CanvasSource | null>(null);
  const [overPlayer, setOverPlayer] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const wall = useRef<HTMLCanvasElement>(null);
  const wallPainter = useRef<CanvasWallPainter | null>(null);
  const [wallFailed, setWallFailed] = useState(false);
  const graffitiDock = useRef<HTMLDivElement>(null);
  const graffitiEditor = useRef<GraffitiEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emptyPlayer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pending = useRef(0);
  const finishAnimation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerSound = useRef<RecordPlayerAudio | null>(null);
  const playbackGeneration = useRef(0);
  const mounted = useRef(true);
  const apply = useCallback((next: CanvasState, reset = false) => {
    if (!mounted.current || next === stateRef.current || (!reset && next.revision < stateRef.current.revision)) return;
    stateRef.current = next; setState(next);
  }, []);
  const clearDragFrame = useCallback(() => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
  }, []);
  const cancel = useCallback(() => {
    if (drag.current) clearTimeout(drag.current.timer); drag.current = null;
    clearDragFrame();
    playbackGeneration.current++;
    if (finishAnimation.current) { clearTimeout(finishAnimation.current); finishAnimation.current = null; }
    playerSound.current?.stop(); setInsertion(null); setGhost(null); setDraggingId(null); setOverPlayer(false);
  }, [clearDragFrame]);
  const primeSound = useCallback(() => { playerSound.current ??= new RecordPlayerAudio(); playerSound.current.unlock(); }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; playbackGeneration.current++; clearDragFrame(); if (drag.current) clearTimeout(drag.current.timer); if (finishAnimation.current) clearTimeout(finishAnimation.current); playerSound.current?.dispose(); playerSound.current = null; };
  }, [clearDragFrame]);
  const selectedCollection = kind === 'album' ? albumCollection : collection;
  const savedAlbums = !online && selectedCollection === 'saved';
  const keyword = query.trim();
  const pickerPath = !picker ? null : online
    ? keyword ? `/api/search?type=${kind}&limit=30&keywords=${encodeURIComponent(keyword)}` : null
    : savedAlbums ? '/api/me/collections' : personalPlaylistPath(selectedCollection);
  useEffect(() => {
    setPickerResult(null);
    if (!pickerPath) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const timer = setTimeout(async () => {
      try {
        let choices: MusicChoice[], warnings: string[] | undefined, playlistCover: string | null | undefined;
        if (savedAlbums) {
          const { items } = await api<{ items: CollectionFavorite[] }>(pickerPath, options);
          choices = items.filter(item => item.kind === 'album' && item.available).map(item => albumChoice(item, item.sub));
        } else if (online && kind === 'album') {
          const { items } = await api<{ items: (AlbumSummary & { artists: Artist[] })[] }>(pickerPath, options);
          choices = items.map(item => albumChoice(item, artistNames(item.artists)));
        } else if (online) {
          const result = await api<{ items: Song[]; warnings?: string[] }>(pickerPath, options);
          choices = result.items.map(songChoice);
          warnings = result.warnings;
        } else {
          const { songs } = await api<{ songs: Song[] }>(pickerPath, options);
          choices = playlistChoices(songs, kind);
          if (songs.length) playlistCover = songs[0].cover ?? null;
        }
        if (!controller.signal.aborted) setPickerResult({ path: pickerPath, kind, choices, warnings, playlistCover });
      } catch (error) {
        if (!controller.signal.aborted) setPickerResult({ path: pickerPath, kind, choices: [], error: (error as Error).message });
      }
    }, online ? 280 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [app.me?.id, kind, online, pickerPath, pickerRetry, savedAlbums]);
  const canvasSettings = state.settings ?? DEFAULT_CANVAS_SETTINGS;
  const wallpaperId = canvasSettings.wallpaper;
  const wallpaper = CANVAS_WALLPAPERS[wallpaperId];
  useLayoutEffect(() => {
    if (!wall.current || !board.current) return;
    const painter = new CanvasWallPainter(wall.current, board.current, setWallFailed);
    wallPainter.current = painter;
    return () => { painter.dispose(); wallPainter.current = null; };
  }, []);
  useLayoutEffect(() => { wallPainter.current?.setWallpaper(wallpaperId); }, [wallpaperId]);
  useLayoutEffect(() => {
    const legacy = state.records.filter(isCanvasGraffiti).map(item => {
      const width = item.graffiti.boardWidth ?? Math.max(12, item.graffiti.width / 2);
      const height = width * item.graffiti.height / item.graffiti.width;
      return { key: item.id, src: `/api/canvas/images/${item.imageFile}`,
        left: item.x - width / 2, top: item.y - height / 2, width, height };
    });
    const tiles = (state.wall ?? []).map(tile => ({
      key: `${tile.x}:${tile.y}`, src: `/api/canvas/wall/${tile.x}/${tile.y}?v=${tile.version}`,
      left: tile.x * WALL_TILE_SIZE, top: tile.y * WALL_TILE_SIZE, width: WALL_TILE_SIZE, height: WALL_TILE_SIZE,
    }));
    wallPainter.current?.setMarks([...legacy, ...tiles]);
  }, [state.records, state.wall]);
  const paintWall = useCallback((view: Camera) => wallPainter.current?.setView(view), []);
  const practiceWall = useCallback((practicing: boolean) => wallPainter.current?.setPractice(practicing), []);
  const camera = useCanvasCamera({
    board, world, onFrame: paintWall, user: app.me?.id,
    minZoom: loaded ? (graffiti ? GRAFFITI_MIN_ZOOM : (canvasSettings.minZoomPercent ?? DEFAULT_CANVAS_SETTINGS.minZoomPercent) / 100) : undefined,
    maxZoom: loaded ? (canvasSettings.zoomLimitPercent ?? DEFAULT_CANVAS_SETTINGS.zoomLimitPercent) / 100 : undefined,
    isDragging: () => !!drag.current?.active,
    onGesture: () => {
      if (graffitiEditor.current) graffitiEditor.current.cancelGesture();
      else { cancel(); setSelected(null); }
    },
  });
  const { refresh, presentPending } = useCanvasSync(app.me?.id, (next, previous) => {
    if (!mounted.current || camera.moving || drag.current || nativeRef.current || insertion || pending.current) return false;
    // Accept a restored server snapshot when the view still displays the older cached baseline.
    const reset = previous === stateRef.current && next.revision < previous.revision;
    if (!reset && next.revision < stateRef.current.revision) return false;
    apply(next, reset);
    setLoaded(true);
    return true;
  }, error => live.current.toast(error.message));
  const displayingDrag = !!ghost || !!nativeSource || !!insertion;
  useEffect(() => {
    if (!camera.moving && !displayingDrag) presentPending();
  }, [camera.moving, displayingDrag, presentPending]);
  const change = useCallback(async (input: Record<string, unknown>) => {
    pending.current++;
    try { const next = await post<CanvasState>('/api/canvas', input); apply(next); return next; }
    catch (error) { live.current.toast((error as Error).message); throw error; }
    finally { pending.current--; presentPending(); }
  }, [apply, presentPending]);
  const point = camera.point;
  const onBoard = useCallback((x: number, y: number) => { const rect = board.current?.getBoundingClientRect(); return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; }, []);
  const receiver = useCallback(() => (document.getElementById('bar') ?? emptyPlayer.current)?.getBoundingClientRect(), []);
  const over = useCallback((x: number, y: number) => {
    const rect = receiver(); return !!rect && x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 28 && y <= rect.bottom + 15;
  }, [receiver]);
  const positionForNewItem = useCallback(() => { const rect = board.current!.getBoundingClientRect(), centre = point(rect.left + rect.width / 2, rect.top + rect.height / 2); const n = stateRef.current.records.length; return { x: centre.x + (n % 3 - 1) * 35, y: centre.y + (n % 5 - 2) * 20 }; }, [point]);
  const graffitiView = useCallback((): GraffitiArea | null => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    const origin = point(rect.left, rect.top);
    const farEdge = point(rect.right, rect.bottom);
    const resolution = Math.min(window.devicePixelRatio || 1, 1.6, MAX_GRAFFITI_SIDE / Math.max(rect.width, rect.height));
    return {
      ...origin, width: farEdge.x - origin.x, height: farEdge.y - origin.y,
      rasterWidth: Math.max(1, Math.round(rect.width * resolution)),
      rasterHeight: Math.max(1, Math.round(rect.height * resolution)),
    };
  }, [point]);
  function startGraffiti() {
    if (graffiti) return;
    if (camera.camera.zoom < GRAFFITI_MIN_ZOOM) camera.zoom(GRAFFITI_MIN_ZOOM / camera.camera.zoom);
    const view = graffitiView();
    if (!view) return;
    setGraffiti(view);
    setTools(false);
    setSelected(null);
  }
  const add = useCallback(async (source: CanvasSource, position?: { x: number; y: number }) => {
    setAdding(true);
    try {
      const next = await change({ ...source, previewSong: undefined, action: 'add', ...(position ?? positionForNewItem()) });
      const added = next.records.at(-1);
      dismissGuide();
      if (added && isCanvasMusic(added) && (showGuide || !playGuideSeen.current)) setPlayGuideId(added.id);
      setPicker(false); setTools(false);
    }
    catch { /* The error is reported by change. */ } finally { if (mounted.current) setAdding(false); }
  }, [change, dismissGuide, positionForNewItem, showGuide]);
  const upload = useCallback(async (file: File, position?: Point, boardWidth?: number) => {
    setAdding(true); pending.current++;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error('图片不能超过 3 MB');
      const at = position ?? positionForNewItem(), form = new FormData(); form.set('file', file); form.set('x', String(at.x)); form.set('y', String(at.y));
      if (boardWidth !== undefined) {
        form.set('graffiti', '1');
        form.set('boardWidth', String(boardWidth));
      }
      apply(await api<CanvasState>('/api/canvas/images', { method: 'POST', body: form })); setTools(false);
    } catch (error) {
      if (boardWidth !== undefined) throw error;
      live.current.toast((error as Error).message);
    }
    finally { pending.current--; presentPending(); if (mounted.current) setAdding(false); }
  }, [apply, positionForNewItem, presentPending]);
  const insert = useCallback((item: CanvasRecord, x: number, y: number, size: number, source?: CanvasSource) => {
    audition.current.stop(); cancel(); setPicker(false); setTools(false);
    const generation = ++playbackGeneration.current;
    const takeAndPlay = () => {
      finishAnimation.current = null;
      if (!mounted.current || generation !== playbackGeneration.current) return;
      pending.current++;
      void (async () => {
        try {
          if (source) {
            const playable = await post<CanvasRecord>('/api/canvas', { action: 'resolve', ...source, previewSong: undefined });
            await live.current.appendMany(playable.tracks ?? [playable.song]);
          } else {
            const next = await live.current.appendMany(item.tracks ?? [item.song], item.id);
            if (next) apply(next); else await refresh();
          }
          if (mounted.current) {
            dismissGuide(); dismissPlaybackGuide();
            window.dispatchEvent(new Event('nt:canvas-open-queue'));
          }
        } catch (error) { if (mounted.current) live.current.toast((error as Error).message); void refresh().catch(() => {}); }
        finally {
          pending.current--;
          presentPending();
          if (mounted.current && generation === playbackGeneration.current) setInsertion(null);
        }
      })();
    };
    if (item.kind !== 'song') { takeAndPlay(); return; }
    const rect = receiver(); if (!rect) return;
    primeSound();
    setInsertion({ item, x: rect.left + rect.width / 2, slotY: rect.top + rect.height * .46, size, fromX: x, fromY: y, source });
    playerSound.current?.insert();
    finishAnimation.current = setTimeout(takeAndPlay, RECORD_INSERT_MS);
  }, [apply, cancel, dismissGuide, dismissPlaybackGuide, presentPending, primeSound, receiver, refresh]);
  const activate = useCallback((operation: Drag) => {
    if (drag.current !== operation || operation.cancelled || operation.active) return;
    if (!operation.source && isCanvasMusic(operation.item)) void audition.current.play(operation.item, false);
    operation.active = true; setSelected(null); setDraggingId(operation.source ? null : operation.item.id);
    setGhost({ item: operation.item, x: operation.x, y: operation.y, size: operation.size });
  }, []);
  const begin = useCallback((event: React.PointerEvent, item: CanvasItem, source?: CanvasSource) => {
    if (!event.isPrimary || event.button !== 0 || drag.current || (event.target as HTMLElement).closest('.nc-record-actions')) return;
    cancel();
    if (isCanvasMusic(item)) primeSound();
    const size = source ? clamp(board.current!.clientWidth * .18, 104, 188) : event.currentTarget.getBoundingClientRect().width;
    const operation: Drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, cancelled: false, timer: setTimeout(() => activate(operation), 360), item, source, size };
    drag.current = operation;
    if (source || event.pointerType !== 'touch') setSelected(source ? null : item.id);
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }, [activate, cancel, primeSound]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const operation = drag.current; if (!operation || event.pointerId !== operation.pointer) return;
      operation.x = event.clientX; operation.y = event.clientY;
      if (!operation.active && Math.hypot(event.clientX - operation.startX, event.clientY - operation.startY) > CANVAS_DRAG_THRESHOLD) {
        if (event.pointerType === 'mouse') activate(operation); else { operation.cancelled = true; clearTimeout(operation.timer); }
      }
      if (!operation.active) return;
      event.preventDefault();
      if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        if (drag.current !== operation) return;
        const { item, x, y, size } = operation;
        setOverPlayer(isCanvasMusic(item) && over(x, y));
        setGhost({ item, x, y, size });
      });
    };
    const finish = (event: PointerEvent) => {
      const operation = drag.current; if (!operation || event.pointerId !== operation.pointer) return;
      clearTimeout(operation.timer); clearDragFrame(); drag.current = null; setDraggingId(null); setOverPlayer(false);
      try {
        if (event.type === 'pointercancel' || operation.cancelled) { setGhost(null); return; }
        if (!operation.active) {
          if (!operation.source) {
            setSelected(operation.item.id);
            if (isCanvasMusic(operation.item)) void audition.current.play(operation.item);
          }
          return;
        }
        setPicker(false); setGhost(null); window.dispatchEvent(new Event('nt:canvas-source-dropped'));
        if (isCanvasMusic(operation.item) && over(event.clientX, event.clientY)) insert(operation.item, event.clientX, event.clientY, operation.size, operation.source);
        else if (onBoard(event.clientX, event.clientY)) {
          const position = point(event.clientX, event.clientY);
          if (operation.source) void add(operation.source, position);
          else {
            const before = stateRef.current;
            const current = before.records.find(r => r.id === operation.item.id);
            if (current) apply({ ...before, records: [...before.records.filter(r => r.id !== current.id), { ...current, ...position }] });
            void change({ action: 'move', id: operation.item.id, ...position }).catch(() => { apply(before); void refresh().catch(() => {}); });
          }
        }
      } finally {
        presentPending();
      }
    };
    const fromTouch = (event: Event) => {
      const detail = (event as CustomEvent<{ source: CanvasSource; pointer: number; x: number; y: number }>).detail;
      cancel(); primeSound();
      const operation: Drag = { pointer: detail.pointer, startX: detail.x, startY: detail.y, x: detail.x, y: detail.y, active: false, cancelled: false, timer: setTimeout(() => {}, 0), item: sourceItem(detail.source), source: detail.source, size: clamp(board.current!.clientWidth * .18, 104, 188) };
      drag.current = operation; activate(operation);
    };
    const touchMove = (event: TouchEvent) => { if (drag.current?.active && event.cancelable) event.preventDefault(); };
    document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish); window.addEventListener('blur', cancel); window.addEventListener('nt:canvas-source', fromTouch);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('touchmove', touchMove); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); window.removeEventListener('blur', cancel); window.removeEventListener('nt:canvas-source', fromTouch); };
  }, [activate, add, apply, cancel, change, clearDragFrame, insert, onBoard, over, point, presentPending, primeSound, refresh]);
  useEffect(() => {
    const native = (event: Event) => { const source = (event as CustomEvent<CanvasSource | null>).detail; nativeRef.current = source; setNativeSource(source); setOverPlayer(false); if (source) primeSound(); else setDropOver(false); };
    const dragging = (event: DragEvent) => {
      if (!event.dataTransfer || !(event.dataTransfer.types.includes(CANVAS_DRAG_TYPE) || event.dataTransfer.types.includes('Files'))) return;
      const accepted = onBoard(event.clientX, event.clientY) || over(event.clientX, event.clientY);
      if (accepted) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
      setDropOver(accepted && onBoard(event.clientX, event.clientY)); setOverPlayer(!!nativeRef.current && over(event.clientX, event.clientY));
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer || !(onBoard(event.clientX, event.clientY) || over(event.clientX, event.clientY))) return;
      const raw = event.dataTransfer.getData(CANVAS_DRAG_TYPE), file = event.dataTransfer.files[0];
      if (!raw && !file) return; event.preventDefault(); setDropOver(false); setOverPlayer(false); nativeRef.current = null; setNativeSource(null);
      window.dispatchEvent(new Event('nt:canvas-source-dropped'));
      if (file && !raw) {
        if (onBoard(event.clientX, event.clientY)) {
          const position = point(event.clientX, event.clientY);
          if (graffitiEditor.current) void graffitiEditor.current.importImage(file, position);
          else void upload(file, position);
        }
        return;
      }
      try {
        const source = JSON.parse(raw) as CanvasSource;
        if (!['song','album','playlist','queue'].includes(source.kind)) return;
        if (over(event.clientX, event.clientY)) insert(sourceItem(source), event.clientX, event.clientY, clamp(board.current!.clientWidth * .18, 104, 188), source);
        else void add(source, point(event.clientX, event.clientY));
      } catch { live.current.toast('无法拖入这个物件'); }
    };
    const library = (event: Event) => {
      setCollection(String((event as CustomEvent).detail)); setKind('song'); setOnline(false); setFilter(''); setPicker(true); setTools(false);
    };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) { setDropOver(false); setOverPlayer(false); } };
    const paste = (event: ClipboardEvent) => { if ((event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) return; const file = event.clipboardData?.files[0]; if (file?.type.startsWith('image/')) { event.preventDefault(); void upload(file); } };
    window.addEventListener('nt:canvas-native', native); window.addEventListener('nt:canvas-library', library); document.addEventListener('dragover', dragging); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop); document.addEventListener('paste', paste);
    return () => { window.removeEventListener('nt:canvas-native', native); window.removeEventListener('nt:canvas-library', library); document.removeEventListener('dragover', dragging); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); document.removeEventListener('paste', paste); };
  }, [add, insert, onBoard, over, point, primeSound, upload]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { audition.current.stop(); cancel(); setPicker(false); setTools(false); setNote(null); setEmojiPicker(false); setSelected(null); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [cancel]);
  const result = pickerResult?.path === pickerPath && pickerResult.kind === kind ? pickerResult : null;
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const choices = useMemo(() => {
    const rows = result?.choices ?? [];
    if (online || !normalizedFilter) return rows;
    return rows.filter(({ source, subtitle }) => `${source.name} ${subtitle}`.toLocaleLowerCase().includes(normalizedFilter));
  }, [result, online, normalizedFilter]);
  const playlistOptions = [{ value: 'favorites', label: '我喜欢的音乐' }, ...app.playlists.map(p => ({ value: String(p.id), label: p.name }))];
  const collectionSource: CanvasSource = {
    kind: 'playlist', playlistId: selectedCollection,
    name: playlistOptions.find(option => option.value === selectedCollection)?.label ?? '歌单',
    cover: result?.playlistCover,
  };
  const canAddCollection = !adding && result?.playlistCover !== undefined;
  const beginSource = (event: React.PointerEvent, source: CanvasSource) => {
    if (!(event.target as Element).closest('button')) begin(event, sourceItem(source), source);
  };
  const selectMusicKind = (value: MusicKind) => {
    if (kind !== value) setFilter('');
    setKind(value);
  };
  const musicLabel = kind === 'song' ? '歌曲' : '专辑';
  const remove = useCallback((id: string) => { void change({ action: 'remove', id }).then(() => setSelected(null)).catch(() => {}); }, [change]);
  const keyboardPlay = useCallback((item: CanvasRecord) => { const rect = receiver(); if (rect) insert(item, rect.left + rect.width / 2, rect.top - 80, clamp(board.current!.clientWidth * .18, 104, 188)); }, [insert, receiver]);
  const tool = async (input: Record<string, unknown>) => { setAdding(true); try { await change({ action: 'tool', ...input, ...positionForNewItem() }); setNote(null); setEmojiPicker(false); setTools(false); } catch {} finally { if (mounted.current) setAdding(false); } };
  const playbackGuideItem = state.records.find(item => item.id === playGuideId);
  useEffect(() => { if (loaded && playGuideId && !playbackGuideItem) setPlayGuideId(null); }, [loaded, playGuideId, playbackGuideItem]);
  const receivingItem = ghost?.item ?? insertion?.item ?? (nativeSource ? sourceItem(nativeSource) : null);
  const receivingCollection = receivingItem && isCanvasMusic(receivingItem) && receivingItem.kind !== 'song';
  const liftedId = draggingId ?? insertion?.item.id;
  const actionItem = ghost || insertion ? null : selected;
  const auditioning = preview.active && !preview.active.loading ? preview.active.id : null;
  const playingSong = app.playing ? app.current?.id : undefined;
  const painting = !!graffiti;
  const items = useMemo(() => state.records.filter(item => !isCanvasGraffiti(item)).map((item, index) =>
      <div key={item.id} data-canvas-item={item.id} className={`nc-record nc-kind-${item.kind} ${liftedId === item.id ? 'nc-lifted' : ''} ${selected === item.id ? 'nc-selected' : ''} ${auditioning === item.id ? 'nc-auditioning' : ''}`} style={{ zIndex: index + 1, left: item.x, top: item.y, '--record-angle': `${item.rotation}deg` } as React.CSSProperties}
        role="button" tabIndex={painting ? -1 : 0} aria-label={`${item.name}，${isCanvasMusic(item) ? item.kind === 'song' ? '单曲' : item.kind === 'album' ? '专辑封套' : '歌单文件夹' : '画布物件'}，${item.ownerName ?? '用户'}放置`} title={item.kind === 'note' ? item.text : item.name}
        onContextMenu={event => event.preventDefault()} onPointerDown={event => begin(event, item)}
        onKeyDown={event => {
          if (painting || event.target !== event.currentTarget) return;
          if ((event.key === 'Enter' || event.key === ' ') && isCanvasMusic(item)) { event.preventDefault(); void audition.current.play(item); }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(item.id); }
          const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
          if (delta) { event.preventDefault(); void change({ action: 'move', id: item.id, x: clamp(item.x + delta[0] * 15, -WORLD_LIMIT, WORLD_LIMIT), y: clamp(item.y + delta[1] * 15, -WORLD_LIMIT, WORLD_LIMIT) }).catch(() => {}); }
        }}>
        <ItemArtwork item={item} spinning={auditioning === item.id || isCanvasMusic(item) && playingSong === item.song.id} />
        <span className="nc-credit" title={`${item.ownerName ?? '用户'}放置`}>{item.ownerAvatar ? <img src={item.ownerAvatar} alt="" loading="lazy" decoding="async" draggable={false} /> : <i>{(item.ownerName ?? '用')[0]}</i>}<span>{item.ownerName ?? '用户'}</span></span>
        {actionItem === item.id && <div className="nc-record-actions">{isCanvasMusic(item) && <button className="ib" aria-label={`拿走并播放${item.name}`} onClick={() => keyboardPlay(item)}><Icon n="play" s={16} /></button>}<button className="ib" aria-label={`取走${item.name}`} onClick={() => remove(item.id)}><Icon n="trash" s={16} /></button></div>}
      </div>
  ), [state.records, liftedId, selected, auditioning, painting, actionItem, playingSong, begin, change, keyboardPlay, remove]);
  return <div className={`music-canvas ${dropOver ? 'nc-drop-over' : ''}`} aria-label="画布"
    style={{ backgroundColor: wallpaper.color, backgroundImage: wallpaper.image ? `url(${wallpaper.image})` : 'none' }}>
    <canvas className="nc-wall" ref={wall} role="img" aria-label="墙面涂鸦" />
    <div className={`nc-board ${camera.moving ? 'nc-panning' : ''} ${camera.spaceDown ? 'nc-space-pan' : ''}`} ref={board} {...camera.handlers} aria-label="共享音乐画布" aria-busy={!loaded} onPointerDown={event => { if (event.target === event.currentTarget) { setSelected(null); setTools(false); setEmojiPicker(false); } }}>
      {!loaded && <div className="nc-loading"><Loading label="正在加载画布" /></div>}
      <div className={`nc-world${graffiti ? ' nc-painting' : ''}`} ref={world}>
      {graffiti && <CanvasGraffiti key={app.me?.id} ref={graffitiEditor} accountId={app.me?.id} initialArea={graffiti} dock={graffitiDock.current}
        guideDepth={state.records.length + 1}
        camera={camera.camera} movingView={camera.moving} getView={graffitiView} onZoom={camera.zoom} onPracticeChange={practiceWall}
        onClose={() => setGraffiti(null)} onPublish={async (file, placed, keepEditor) => {
          if (!(stateRef.current.settings ?? DEFAULT_CANVAS_SETTINGS).allowGraffiti) throw new Error('画布暂时关闭了涂鸦发布');
          await upload(file, placed, placed.width);
          if (!keepEditor) setGraffiti(null);
        }} />}
      {items}
      </div>
    </div>
    <div ref={graffitiDock} />
    {!graffiti && <div className="nc-camera panel" role="group" aria-label="画布视角"><button className="ib" aria-label="缩小画布" onClick={() => camera.zoom(1 / 1.25)}>−</button><span>{Math.round(camera.camera.zoom * 100)}%</span><button className="ib" aria-label="放大画布" onClick={() => camera.zoom(1.25)}>+</button><button className="ib" aria-label="查看全部物件" title="查看全部物件" onClick={() => camera.fit([
      ...state.records, ...(state.wall ?? []).map(tile => ({ x: (tile.x + .5) * WALL_TILE_SIZE, y: (tile.y + .5) * WALL_TILE_SIZE })),
    ])}><Icon n="refresh" s={17} /></button>{wallFailed && <button className="ib" aria-label="重试加载墙面涂鸦"
      title="重试加载墙面涂鸦" onClick={() => {
        wallPainter.current?.retry();
        void refresh().catch(error => live.current.toast(error.message));
      }}><Icon n="refresh" s={17} /></button>}</div>}
    {preview.active && <button className="nc-audition-status panel" onClick={preview.stop} aria-label="停止试听">{preview.active.loading ? <Loading inline /> : <Icon n="pause" s={15} />}<span>{preview.active.label}</span><Icon n="x" s={14} /></button>}
    <button className="nc-add ib" aria-label="画布工具" title="画布工具" aria-expanded={tools} onClick={() => { setTools(value => !value); setEmojiPicker(false); }}><Icon n={tools ? 'x' : 'plus'} s={22} /></button>
    {tools && <div className="nc-tools panel" role="menu" aria-label="画布小工具">
      <div className="nc-tools-quota sub sm" role="presentation">我的物品 {state.records.filter(item => item.ownerId === app.me?.id && !isCanvasGraffiti(item)).length} / {canvasSettings.personalLimit}</div>
      <button role="menuitem" onClick={() => { setNote({ text: '', color: 'butter', captureMoment: false }); setTools(false); }}><Icon n="sticker" />便签</button>
      <button role="menuitem" disabled={adding || !!graffiti} onClick={startGraffiti}><Icon n="spray" />{canvasSettings.allowGraffiti ? '涂鸦' : '涂鸦（暂停发布）'}</button>
      <button role="menuitem" disabled={adding} onClick={() => fileInput.current?.click()}><Icon n="picture" />图片 / 表情包</button>
      <button role="menuitem" onClick={() => { setEmojiPicker(true); setTools(false); }}><Icon n="smile" />表情</button>
      <button role="menuitem" onClick={() => { setFilter(''); setPicker(true); setTools(false); }}><Icon n="note" />添加音乐</button>
      <button role="menuitem" onClick={() => { setPlayGuideId(null); setShowGuide(true); setTools(false); }}><Icon n="note" />操作指引</button>
    </div>}
    <input type="file" ref={fileInput} hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择画布图片" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    {emojiPicker && <div className="nc-emoji-picker panel" role="dialog" aria-label="选择表情"><button className="ib nc-emoji-close" aria-label="关闭表情" onClick={() => setEmojiPicker(false)}><Icon n="x" s={16} /></button>{EMOJI.map(emoji => <button key={emoji} disabled={adding} aria-label={`贴上${emoji}`} onClick={() => void tool({ kind: 'emoji', emoji })}>{emoji}</button>)}</div>}
    {adding && <div className="nc-saving"><Loading inline label="正在放到画布" /></div>}
    {!app.current && <div ref={emptyPlayer} className="nc-empty-player" role="region" aria-label="唱片播放器"><span className="nc-slot" /><Icon n="play" s={20} /></div>}
    {(ghost && isCanvasMusic(ghost.item) || insertion || nativeSource) && <div className={`nc-receiver ${receivingCollection ? 'nc-receiver-collection' : ''} ${overPlayer || insertion ? 'nc-receiver-ready' : ''} ${insertion ? 'nc-receiver-loading' : ''}`} aria-label={insertion ? '唱片正在装入播放器' : receivingCollection ? '松开以接到播放列表末尾' : '松开唱片以加入播放列表'}><span className="nc-platter" /><span className="nc-slot" /><i className="nc-machine-light" /><Icon n={receivingCollection ? 'list' : 'play'} s={22} /></div>}
    {ghost && <div className={`nc-ghost nc-kind-${ghost.item.kind} ${auditioning === ghost.item.id ? 'nc-auditioning' : ''} ${overPlayer ? 'nc-ghost-ready' : ''}`} style={{ '--drag-x': `${ghost.x}px`, '--drag-y': `${ghost.y}px`, width: ghost.size } as React.CSSProperties} aria-hidden="true"><ItemArtwork item={ghost.item} spinning={auditioning === ghost.item.id} /></div>}
    {insertion && <div className="nc-insertion" aria-hidden="true" style={{ '--intake-x': `${insertion.x}px`, '--slot-y': `${insertion.slotY}px`, '--disc-size': `${insertion.size}px`, '--approach-x': `${insertion.fromX - insertion.x}px`, '--approach-y': `${insertion.fromY - (insertion.slotY - insertion.size / 2)}px`, '--intake-duration': `${RECORD_INSERT_MS}ms` } as React.CSSProperties}><div className="nc-intake-clip"><div className="nc-feeding-disc"><ItemArtwork item={insertion.item} /></div></div><div className="nc-intake-lip" /></div>}
    {picker && createPortal(<div className={`nc-picker-mask ${ghost ? 'nc-picker-dragging' : ''}`} onPointerDown={event => { if (event.target === event.currentTarget) setPicker(false); }}>
      <section className="nc-picker panel" role="dialog" aria-modal="true" aria-label="添加音乐">
        <header>
          <nav className="chips" aria-label="音乐类型">
            <button className={`chip ${kind === 'song' ? 'on' : ''}`} aria-pressed={kind === 'song'} onClick={() => selectMusicKind('song')}>歌曲</button>
            <button className={`chip ${kind === 'album' ? 'on' : ''}`} aria-pressed={kind === 'album'} onClick={() => selectMusicKind('album')}>专辑</button>
          </nav>
          <button className="chip nc-search-toggle" onClick={() => setOnline(value => !value)}><Icon n={online ? 'note' : 'search'} s={15} />{online ? '我的音乐' : '在线搜索'}</button>
          <button className="ib" aria-label="关闭音乐选择" onClick={() => setPicker(false)}><Icon n="x" s={19} /></button>
        </header>
        {!online && <Select value={selectedCollection} onChange={value => { setFilter(''); (kind === 'album' ? setAlbumCollection : setCollection)(value); }}
          aria-label={kind === 'album' ? '专辑来源' : '选择歌单'}
          options={kind === 'album' ? [{ value: 'saved', label: '收藏的专辑' }, ...playlistOptions] : playlistOptions} />}
        {!online && !savedAlbums && <div className="nc-bundle-source" onPointerDown={event => { if (canAddCollection) beginSource(event, collectionSource); }}>
          <span><Icon n="list" s={17} />整张歌单</span>
          <button className="ib" disabled={!canAddCollection} aria-label="贴上整张歌单" onClick={() => void add(collectionSource)}><Icon n="plus" s={18} /></button>
        </div>}
        <label className="search">
          <Icon n="search" s={17} />
          <input key={online ? 'online' : 'library'} type="search" value={online ? query : filter}
            onChange={event => (online ? setQuery : setFilter)(event.target.value)} maxLength={100}
            aria-label={online ? `在线搜索${musicLabel}` : `筛选${musicLabel}`}
            placeholder={online ? (kind === 'song' ? '搜索歌名或歌手' : '搜索专辑名或歌手') : `筛选${musicLabel}`} />
        </label>
        <div className="nc-music-list">
          {pickerPath && !result && <Loading label={online ? `正在搜索${musicLabel}` : '正在读取音乐'} />}
          {result?.error && <div className="center"><p className="sub sm" role="alert">{result.error}</p><button className="btn ghost sm" onClick={() => setPickerRetry(value => value + 1)}>重试</button></div>}
          {result?.warnings?.map(warning => <p key={warning} className="sub sm" role="status">{warning}</p>)}
          {choices.map(({ source, subtitle }) => <div className="nc-music-row" key={source.songId ?? source.albumId}
            onPointerDown={event => { if (!adding) beginSource(event, source); }} onContextMenu={event => event.preventDefault()}>
            <ItemArtwork item={sourceItem(source)} />
            <span><b className="t1">{source.name}</b><small className="sub t1">{subtitle}</small></span>
            <button className="ib" disabled={adding} aria-label={`贴上${source.name}`} onClick={() => void add(source)}><Icon n="plus" s={18} /></button>
          </div>)}
          {result && !result.error && !choices.length && <p role="status" className="center sub sm">
            {online || normalizedFilter ? `没有找到相关${musicLabel}` : savedAlbums ? '暂无收藏的专辑' : `暂无${musicLabel}`}
          </p>}
        </div>
      </section>
    </div>, document.body)}
    {loaded && !camera.moving && !note && !graffiti && !picker && !tools && !emojiPicker && !insertion && ((playbackGuideItem && !overPlayer) || (showGuide && !ghost)) && <CanvasGuide board={board} view={camera.camera} playItem={playbackGuideItem} held={playbackGuideItem && ghost && draggingId && isCanvasMusic(ghost.item) ? ghost : undefined} onDismiss={playbackGuideItem ? dismissPlaybackGuide : dismissGuide} />}
    {note && <Sheet title="便签" className="nc-note-sheet" onClose={() => setNote(null)}>
      <form className="nc-note-editor" onSubmit={event => { event.preventDefault(); void tool({ kind: 'note', ...note }); }}>
        <textarea aria-label="便签内容" value={note.text} onChange={event => setNote({ ...note, text: event.target.value })} placeholder="留一句话…" maxLength={800} required />
        <div className="nc-note-options">
          <div className="row nc-note-colors" aria-label="便签颜色">
            {['paper', 'butter', 'rose', 'mint'].map(color => <button type="button" key={color} className={`nc-color-${color} ${note.color === color ? 'on' : ''}`} aria-label={`便签颜色${color}`} aria-pressed={note.color === color} onClick={() => setNote({ ...note, color })} />)}
          </div>
          <label className="nc-note-moment-option" title="贴上便签时记录时间">
            <input type="checkbox" checked={note.captureMoment} onChange={event => setNote({ ...note, captureMoment: event.target.checked })} />
            此时此刻
          </label>
        </div>
        <div className="row nc-note-actions">
          <button type="button" className="btn ghost sm" onClick={() => setNote(null)}>取消</button>
          <button className="btn sm" disabled={adding || !note.text.trim()}>贴上画布</button>
        </div>
      </form>
    </Sheet>}
  </div>;
}

const momentFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const ItemArtwork = memo(function ItemArtwork({ item, spinning = false }: { item: CanvasItem; spinning?: boolean }) {
  if (item.kind === 'note') {
    const moment = item.moment;
    return <div className={`nc-paper nc-color-${item.color}${moment ? ' nc-paper-stamped' : ''}`}>
      <span>{item.text}</span>
      {moment && <time className={`nc-note-stamp nc-note-stamp-${moment.font}`} dateTime={new Date(moment.timestamp).toISOString()} title="北京时间">
        {momentFormat.format(moment.timestamp)}
      </time>}
      <i />
    </div>;
  }
  if (item.kind === 'image') return <div className="nc-photo"><CanvasImage src={`/api/canvas/images/${item.imageFile}`} alt="画布图片" /></div>;
  if (item.kind === 'emoji') return <div className="nc-emoji-art">{item.emoji}</div>;
  const count = item.tracks?.length ? `${item.tracks.length} 首` : '';
  if (item.kind === 'album') return <div className="nc-music-art nc-album-art">
    <div className="nc-album-disc"><Vinyl song={item.song} spinning={spinning} /></div>
    <div className="nc-album-jacket"><Cover src={item.song.cover} seed={item.song.id || item.name} /><i className="nc-album-spine" /><i className="nc-album-sheen" />{count && <span className="nc-album-count">{count}</span>}</div>
  </div>;
  if (item.kind === 'playlist' || item.kind === 'queue') {
    const second = item.tracks?.[1] ?? item.song;
    return <div className="nc-music-art nc-folder-art">
      <div className="nc-folder-back" />
      <div className="nc-folder-paper"><Cover src={second.cover} seed={second.id || item.name} /></div>
      <div className="nc-folder-disc"><Vinyl song={item.song} spinning={spinning} /></div>
      <div className="nc-folder-front"><i /><b>{item.name}</b>{count && <small>{count}</small>}</div>
    </div>;
  }
  return <div className="nc-music-art"><Vinyl song={item.song} spinning={spinning} /></div>;
});

function Vinyl({ song, spinning = false }: { song: Song; spinning?: boolean }) {
  return <div className={`nc-disc ${spinning ? 'nc-spinning' : ''}`}><Cover src={song.cover} seed={song.id || song.name} /><i className="nc-spindle" /></div>;
}
