'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, get, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { CANVAS_DRAG_TYPE, isCanvasMusic, type CanvasItem, type CanvasRecord, type CanvasSource, type CanvasState } from '@/lib/canvas-types';
import type { Song } from '@/lib/types';
import { RecordPlayerAudio, RECORD_INSERT_MS } from '@/lib/record-player-audio';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';
import { Sheet } from './Sheet';
import { CanvasGuide } from './CanvasGuide';

type Drag = { pointer: number; startX: number; startY: number; x: number; y: number; active: boolean; cancelled: boolean; timer: ReturnType<typeof setTimeout>; item: CanvasItem; source?: CanvasSource; size: number };
type Ghost = { item: CanvasItem; x: number; y: number; size: number };
type Insertion = { item: CanvasRecord; x: number; slotY: number; size: number; fromX: number; fromY: number; source?: CanvasSource };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const EMOJI = ['🎵','🎧','💿','📼','🎸','🎹','❤️','✨','⭐','🌙','☀️','🌈','🌷','🌻','🍀','🍒','☕','🍰','🐱','🐶','🫶','🥹','😎','🤍'];
function sourceItem(source: CanvasSource): CanvasRecord {
  const song = source.previewSong ?? { id: source.songId ?? '', name: source.name, cover: source.cover ?? null, artists: [], duration: 0, album: { id: source.albumId ?? null, name: source.name } };
  return { id: '', ownerId: 0, x: 500, y: 300, rotation: 0, kind: source.kind, name: source.name, song, albumId: source.albumId ?? null };
}
const songSource = (song: Song, kind: 'song' | 'album' = 'song'): CanvasSource => ({ kind, songId: song.id, albumId: kind === 'album' ? song.album.id ?? undefined : undefined, name: kind === 'album' ? song.album.name : song.name, cover: song.cover, previewSong: song });

export function Square() {
  const app = useApp();
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
  const [note, setNote] = useState<{ text: string; color: string } | null>(null);
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [collection, setCollection] = useState('favorites');
  const [kind, setKind] = useState<'song' | 'album'>('song');
  const [songs, setSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
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
  const fileInput = useRef<HTMLInputElement>(null);
  const emptyPlayer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pending = useRef(0);
  const finishAnimation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerSound = useRef<RecordPlayerAudio | null>(null);
  const playbackGeneration = useRef(0);
  const mounted = useRef(true);
  const apply = useCallback((next: CanvasState) => {
    if (!mounted.current || next.revision < stateRef.current.revision) return;
    stateRef.current = next; setState(next);
  }, []);
  const refresh = useCallback(async () => {
    const next = await get<CanvasState>('/api/canvas');
    if (!drag.current && !pending.current) { apply(next); if (mounted.current) setLoaded(true); }
  }, [apply]);
  const change = useCallback(async (input: Record<string, unknown>) => {
    pending.current++;
    try { const next = await post<CanvasState>('/api/canvas', input); apply(next); return next; }
    catch (error) { live.current.toast((error as Error).message); throw error; }
    finally { pending.current--; }
  }, [apply]);
  const cancel = useCallback(() => {
    if (drag.current) clearTimeout(drag.current.timer); drag.current = null;
    playbackGeneration.current++;
    if (finishAnimation.current) { clearTimeout(finishAnimation.current); finishAnimation.current = null; }
    playerSound.current?.stop(); setInsertion(null); setGhost(null); setDraggingId(null); setOverPlayer(false);
  }, []);
  const primeSound = useCallback(() => { playerSound.current ??= new RecordPlayerAudio(); playerSound.current.unlock(); }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(error => live.current.toast(error.message));
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 2000);
    const focus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; playbackGeneration.current++; clearInterval(timer); window.removeEventListener('focus', focus); if (drag.current) clearTimeout(drag.current.timer); if (finishAnimation.current) clearTimeout(finishAnimation.current); playerSound.current?.dispose(); playerSound.current = null; };
  }, [refresh]);
  useEffect(() => {
    if (!picker) return;
    let active = true; setBusy(true); setQuery('');
    get<{ songs: Song[] }>(collection === 'favorites' ? '/api/me/favorites' : `/api/me/playlists/${collection}`)
      .then(data => { if (active) setSongs(data.songs ?? []); })
      .catch(error => live.current.toast(error.message)).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [collection, picker]);
  const point = useCallback((x: number, y: number) => {
    const rect = board.current!.getBoundingClientRect();
    return { x: clamp((x - rect.left) / rect.width * 1000, 90, 910), y: clamp((y - rect.top) / rect.height * 650, 90, 560) };
  }, []);
  const onBoard = useCallback((x: number, y: number) => { const rect = board.current?.getBoundingClientRect(); return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; }, []);
  const receiver = useCallback(() => (document.getElementById('bar') ?? emptyPlayer.current)?.getBoundingClientRect(), []);
  const over = useCallback((x: number, y: number) => {
    const rect = receiver(); return !!rect && x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 28 && y <= rect.bottom + 15;
  }, [receiver]);
  const positionForNewItem = useCallback(() => { const n = stateRef.current.records.length; return { x: 180 + (n * 173) % 640, y: 130 + (n * 113) % 360 }; }, []);
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
  const upload = useCallback(async (file: File, position?: { x: number; y: number }) => {
    if (file.size > 3 * 1024 * 1024) { live.current.toast('图片不能超过 3 MB'); return; }
    setAdding(true); pending.current++;
    try {
      const at = position ?? positionForNewItem(), form = new FormData(); form.set('file', file); form.set('x', String(at.x)); form.set('y', String(at.y));
      apply(await api<CanvasState>('/api/canvas/images', { method: 'POST', body: form })); setTools(false);
    } catch (error) { live.current.toast((error as Error).message); }
    finally { pending.current--; if (mounted.current) setAdding(false); }
  }, [apply, positionForNewItem]);
  const insert = useCallback((item: CanvasRecord, x: number, y: number, size: number, source?: CanvasSource) => {
    cancel(); setPicker(false); setTools(false);
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
        finally { pending.current--; if (mounted.current && generation === playbackGeneration.current) setInsertion(null); }
      })();
    };
    if (item.kind !== 'song') { takeAndPlay(); return; }
    const rect = receiver(); if (!rect) return;
    primeSound();
    setInsertion({ item, x: rect.left + rect.width / 2, slotY: rect.top + rect.height * .46, size, fromX: x, fromY: y, source });
    playerSound.current?.insert();
    finishAnimation.current = setTimeout(takeAndPlay, RECORD_INSERT_MS);
  }, [apply, cancel, dismissGuide, dismissPlaybackGuide, primeSound, receiver, refresh]);
  const activate = useCallback((operation: Drag) => {
    if (drag.current !== operation || operation.cancelled || operation.active) return;
    operation.active = true; setSelected(null); setDraggingId(operation.source ? null : operation.item.id);
    setGhost({ item: operation.item, x: operation.x, y: operation.y, size: operation.size });
  }, []);
  const begin = (event: React.PointerEvent, item: CanvasItem, source?: CanvasSource) => {
    if (!event.isPrimary || event.button !== 0 || drag.current || (event.target as HTMLElement).closest('.nc-record-actions')) return;
    cancel(); primeSound();
    const size = source ? clamp(board.current!.clientWidth * .18, 104, 188) : event.currentTarget.getBoundingClientRect().width;
    const operation: Drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, cancelled: false, timer: setTimeout(() => activate(operation), 360), item, source, size };
    drag.current = operation; setSelected(source ? null : item.id);
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const operation = drag.current; if (!operation || event.pointerId !== operation.pointer) return;
      operation.x = event.clientX; operation.y = event.clientY;
      if (!operation.active && Math.hypot(event.clientX - operation.startX, event.clientY - operation.startY) > 7) {
        if (event.pointerType === 'mouse') activate(operation); else { operation.cancelled = true; clearTimeout(operation.timer); }
      }
      if (!operation.active) return; event.preventDefault();
      setGhost({ item: operation.item, x: event.clientX, y: event.clientY, size: operation.size }); setOverPlayer(isCanvasMusic(operation.item) && over(event.clientX, event.clientY));
    };
    const finish = (event: PointerEvent) => {
      const operation = drag.current; if (!operation || event.pointerId !== operation.pointer) return;
      clearTimeout(operation.timer); drag.current = null; setDraggingId(null); setOverPlayer(false);
      if (event.type === 'pointercancel' || !operation.active) { setGhost(null); return; }
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
  }, [activate, add, apply, cancel, change, insert, onBoard, over, point, primeSound, refresh]);
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
      if (file && !raw) { if (onBoard(event.clientX, event.clientY)) void upload(file, point(event.clientX, event.clientY)); return; }
      try {
        const source = JSON.parse(raw) as CanvasSource;
        if (!['song','album','playlist','queue'].includes(source.kind)) return;
        if (over(event.clientX, event.clientY)) insert(sourceItem(source), event.clientX, event.clientY, clamp(board.current!.clientWidth * .18, 104, 188), source);
        else void add(source, point(event.clientX, event.clientY));
      } catch { live.current.toast('无法拖入这个物件'); }
    };
    const library = (event: Event) => { setCollection(String((event as CustomEvent).detail)); setPicker(true); setTools(false); };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) { setDropOver(false); setOverPlayer(false); } };
    const paste = (event: ClipboardEvent) => { if ((event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) return; const file = event.clipboardData?.files[0]; if (file?.type.startsWith('image/')) { event.preventDefault(); void upload(file); } };
    window.addEventListener('nt:canvas-native', native); window.addEventListener('nt:canvas-library', library); document.addEventListener('dragover', dragging); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop); document.addEventListener('paste', paste);
    return () => { window.removeEventListener('nt:canvas-native', native); window.removeEventListener('nt:canvas-library', library); document.removeEventListener('dragover', dragging); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); document.removeEventListener('paste', paste); };
  }, [add, insert, onBoard, over, point, primeSound, upload]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancel(); setPicker(false); setTools(false); setNote(null); setEmojiPicker(false); setSelected(null); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [cancel]);
  const sources = useMemo(() => {
    const list = songs.map(song => songSource(song, kind));
    return (kind === 'album' ? [...new Map(list.filter(m => m.albumId).map(m => [m.albumId, m])).values()] : list).filter(m => (m.name + m.previewSong!.artists.map(a => a.name).join(' ')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }, [kind, query, songs]);
  const collectionSource: CanvasSource = { kind: 'playlist', playlistId: collection, name: collection === 'favorites' ? '我喜欢的音乐' : app.playlists.find(p => String(p.id) === collection)?.name ?? '歌单', cover: songs[0]?.cover };
  const remove = (id: string) => { void change({ action: 'remove', id }).then(() => setSelected(null)).catch(() => {}); };
  const keyboardPlay = (item: CanvasRecord) => { const rect = receiver(); if (rect) insert(item, rect.left + rect.width / 2, rect.top - 80, clamp(board.current!.clientWidth * .18, 104, 188)); };
  const tool = async (input: Record<string, unknown>) => { setAdding(true); try { await change({ action: 'tool', ...input, ...positionForNewItem() }); setNote(null); setEmojiPicker(false); setTools(false); } catch {} finally { if (mounted.current) setAdding(false); } };
  const playbackGuideItem = state.records.find(item => item.id === playGuideId);
  useEffect(() => { if (loaded && playGuideId && !playbackGuideItem) setPlayGuideId(null); }, [loaded, playGuideId, playbackGuideItem]);
  const receivingItem = ghost?.item ?? insertion?.item ?? (nativeSource ? sourceItem(nativeSource) : null);
  const receivingCollection = receivingItem && isCanvasMusic(receivingItem) && receivingItem.kind !== 'song';
  return <div className={`music-canvas ${dropOver ? 'nc-drop-over' : ''}`} aria-label="画布">
    <div className="nc-board" ref={board} aria-label="共享音乐画布" aria-busy={!loaded} onPointerDown={event => { if (event.target === event.currentTarget) { setSelected(null); setTools(false); setEmojiPicker(false); } }}>
      {!loaded && <div className="nc-loading"><Loading label="正在加载画布" /></div>}
      {state.records.map((item, index) => <div key={item.id} data-canvas-item={item.id} className={`nc-record nc-kind-${item.kind} ${draggingId === item.id || insertion?.item.id === item.id ? 'nc-lifted' : ''} ${selected === item.id ? 'nc-selected' : ''}`} style={{ zIndex: index + 1, left: `clamp(calc(var(--object-size) / 2 + 15px),${item.x / 10}%,calc(100% - var(--object-size) / 2 - 15px))`, top: `clamp(calc(var(--object-size) / 2 + 18px),${item.y / 6.5}%,calc(100% - var(--object-size) / 2 - 18px))`, '--record-angle': `${item.rotation}deg` } as React.CSSProperties}
        role="button" tabIndex={0} aria-label={`${item.name}，${isCanvasMusic(item) ? item.kind === 'song' ? '单曲' : item.kind === 'album' ? '专辑封套' : '歌单文件夹' : '画布物件'}，${item.ownerName ?? '用户'}放置`} title={item.kind === 'note' ? item.text : item.name}
        onContextMenu={event => event.preventDefault()} onPointerDown={event => begin(event, item)} onDoubleClick={() => { if (isCanvasMusic(item)) keyboardPlay(item); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if ((event.key === 'Enter' || event.key === ' ') && isCanvasMusic(item)) { event.preventDefault(); keyboardPlay(item); }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(item.id); }
          const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
          if (delta) { event.preventDefault(); void change({ action: 'move', id: item.id, x: clamp(item.x + delta[0] * 15, 90, 910), y: clamp(item.y + delta[1] * 15, 90, 560) }).catch(() => {}); }
        }}>
        <ItemArtwork item={item} spinning={isCanvasMusic(item) && app.current?.id === item.song.id && app.playing} />
        <span className="nc-credit" title={`${item.ownerName ?? '用户'}放置`}>{item.ownerAvatar ? <img src={item.ownerAvatar} alt="" draggable={false} /> : <i>{(item.ownerName ?? '用')[0]}</i>}<span>{item.ownerName ?? '用户'}</span></span>
        {selected === item.id && !ghost && !insertion && <div className="nc-record-actions">{isCanvasMusic(item) && <button className="ib" aria-label={`拿走并播放${item.name}`} onClick={() => keyboardPlay(item)}><Icon n="play" s={16} /></button>}<button className="ib" aria-label={`取走${item.name}`} onClick={() => remove(item.id)}><Icon n="trash" s={16} /></button></div>}
      </div>)}
    </div>
    <button className="nc-add ib" aria-label="画布工具" title="画布工具" aria-expanded={tools} onClick={() => { setTools(value => !value); setEmojiPicker(false); }}><Icon n={tools ? 'x' : 'plus'} s={22} /></button>
    {tools && <div className="nc-tools panel" role="menu" aria-label="画布小工具"><button role="menuitem" onClick={() => { setNote({ text: '', color: 'butter' }); setTools(false); }}><Icon n="sticker" />便签</button><button role="menuitem" disabled={adding} onClick={() => fileInput.current?.click()}><Icon n="picture" />图片 / 表情包</button><button role="menuitem" onClick={() => { setEmojiPicker(true); setTools(false); }}><Icon n="smile" />表情</button><button role="menuitem" onClick={() => { setPicker(true); setTools(false); }}><Icon n="note" />从歌单选音乐</button><button role="menuitem" onClick={() => { setPlayGuideId(null); setShowGuide(true); setTools(false); }}><Icon n="note" />操作指引</button></div>}
    <input type="file" ref={fileInput} hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择画布图片" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    {emojiPicker && <div className="nc-emoji-picker panel" role="dialog" aria-label="选择表情"><button className="ib nc-emoji-close" aria-label="关闭表情" onClick={() => setEmojiPicker(false)}><Icon n="x" s={16} /></button>{EMOJI.map(emoji => <button key={emoji} disabled={adding} aria-label={`贴上${emoji}`} onClick={() => void tool({ kind: 'emoji', emoji })}>{emoji}</button>)}</div>}
    {adding && <div className="nc-saving"><Loading inline label="正在放到画布" /></div>}
    {!app.current && <div ref={emptyPlayer} className="nc-empty-player" role="region" aria-label="唱片播放器"><span className="nc-slot" /><Icon n="play" s={20} /></div>}
    {(ghost && isCanvasMusic(ghost.item) || insertion || nativeSource) && <div className={`nc-receiver ${receivingCollection ? 'nc-receiver-collection' : ''} ${overPlayer || insertion ? 'nc-receiver-ready' : ''} ${insertion ? 'nc-receiver-loading' : ''}`} aria-label={insertion ? '唱片正在装入播放器' : receivingCollection ? '松开以接到播放列表末尾' : '松开唱片以加入播放列表'}><span className="nc-platter" /><span className="nc-slot" /><i className="nc-machine-light" /><Icon n={receivingCollection ? 'list' : 'play'} s={22} /></div>}
    {ghost && <div className={`nc-ghost nc-kind-${ghost.item.kind} ${overPlayer ? 'nc-ghost-ready' : ''}`} style={{ left: ghost.x, top: ghost.y, width: ghost.size }} aria-hidden="true"><ItemArtwork item={ghost.item} /></div>}
    {insertion && <div className="nc-insertion" aria-hidden="true" style={{ '--intake-x': `${insertion.x}px`, '--slot-y': `${insertion.slotY}px`, '--disc-size': `${insertion.size}px`, '--approach-x': `${insertion.fromX - insertion.x}px`, '--approach-y': `${insertion.fromY - (insertion.slotY - insertion.size / 2)}px`, '--intake-duration': `${RECORD_INSERT_MS}ms` } as React.CSSProperties}><div className="nc-intake-clip"><div className="nc-feeding-disc"><ItemArtwork item={insertion.item} /></div></div><div className="nc-intake-lip" /></div>}
    {picker && <div className={`nc-picker-mask ${ghost ? 'nc-picker-dragging' : ''}`} onPointerDown={event => { if (event.target === event.currentTarget) setPicker(false); }}>
      <section className="nc-picker panel" role="dialog" aria-modal="true" aria-label="从歌单添加唱片">
        <header><nav className="chips" aria-label="唱片类型">{(['song', 'album'] as const).map(value => <button key={value} className={`chip ${kind === value ? 'on' : ''}`} onClick={() => setKind(value)}>{value === 'song' ? '歌曲' : '专辑'}</button>)}</nav><button className="ib" aria-label="关闭音乐选择" onClick={() => setPicker(false)}><Icon n="x" s={19} /></button></header>
        <select value={collection} onChange={event => setCollection(event.target.value)} aria-label="选择歌单"><option value="favorites">我喜欢的音乐</option>{app.playlists.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}</select>
        <div className="nc-bundle-source" onPointerDown={event => { if (!(event.target as HTMLElement).closest('button')) begin(event, sourceItem(collectionSource), collectionSource); }}><span><Icon n="list" s={17} />整张歌单</span><button className="ib" disabled={adding || busy || !songs.length} aria-label="贴上整张歌单" onClick={() => void add(collectionSource)}><Icon n="plus" s={18} /></button></div>
        <label className="search"><Icon n="search" s={17} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索唱片" placeholder="搜索音乐" /></label>
        <div className="nc-music-list">{busy ? <Loading /> : sources.map(source => <div className="nc-music-row" key={source.kind + source.songId} onPointerDown={event => { if (!(event.target as HTMLElement).closest('button')) begin(event, sourceItem(source), source); }} onContextMenu={event => event.preventDefault()}><ItemArtwork item={sourceItem(source)} /><span><b className="t1">{source.name}</b><small className="sub t1">{source.previewSong!.artists.map(a => a.name).join(' / ')}</small></span><button className="ib" disabled={adding} aria-label={`贴上${source.name}`} onClick={() => void add(source)}><Icon n="plus" s={18} /></button></div>)}{!busy && !sources.length && <p className="center sub sm">暂无音乐</p>}</div>
      </section>
    </div>}
    {loaded && !note && !picker && !tools && !emojiPicker && !insertion && ((playbackGuideItem && !overPlayer) || (showGuide && !ghost)) && <CanvasGuide board={board} playItem={playbackGuideItem} held={playbackGuideItem && ghost && draggingId && isCanvasMusic(ghost.item) ? ghost : undefined} onDismiss={playbackGuideItem ? dismissPlaybackGuide : dismissGuide} />}
    {note && <Sheet title="便签" className="nc-note-sheet" onClose={() => setNote(null)}><form className="nc-note-editor" onSubmit={event => { event.preventDefault(); void tool({ kind: 'note', ...note }); }}><textarea aria-label="便签内容" value={note.text} onChange={event => setNote({ ...note, text: event.target.value })} placeholder="留一句话…" maxLength={800} required /><div className="row nc-note-colors" aria-label="便签颜色">{['paper','butter','rose','mint'].map(color => <button type="button" key={color} className={`nc-color-${color} ${note.color === color ? 'on' : ''}`} aria-label={`便签颜色${color}`} aria-pressed={note.color === color} onClick={() => setNote({ ...note, color })} />)}</div><div className="row nc-note-actions"><button type="button" className="btn ghost sm" onClick={() => setNote(null)}>取消</button><button className="btn sm" disabled={adding || !note.text.trim()}>贴上画布</button></div></form></Sheet>}
  </div>;
}

function ItemArtwork({ item, spinning = false }: { item: CanvasItem; spinning?: boolean }) {
  if (item.kind === 'note') return <div className={`nc-paper nc-color-${item.color}`}><span>{item.text}</span><i /></div>;
  if (item.kind === 'image') return <div className="nc-photo"><img src={`/api/canvas/images/${item.imageFile}`} alt="画布图片" draggable={false} /></div>;
  if (item.kind === 'emoji') return <div className="nc-emoji-art">{item.emoji}</div>;
  const count = item.tracks?.length ? `${item.tracks.length} 首` : '';
  if (item.kind === 'album') return <div className="nc-music-art nc-album-art">
    <div className="nc-album-disc"><Vinyl song={item.song} /></div>
    <div className="nc-album-jacket"><Cover src={item.song.cover} seed={item.song.id || item.name} /><i className="nc-album-spine" /><i className="nc-album-sheen" />{count && <span className="nc-album-count">{count}</span>}</div>
  </div>;
  if (item.kind === 'playlist' || item.kind === 'queue') {
    const second = item.tracks?.[1] ?? item.song;
    return <div className="nc-music-art nc-folder-art">
      <div className="nc-folder-back" />
      <div className="nc-folder-paper"><Cover src={second.cover} seed={second.id || item.name} /></div>
      <div className="nc-folder-disc"><Vinyl song={item.song} /></div>
      <div className="nc-folder-front"><i /><b>{item.name}</b>{count && <small>{count}</small>}</div>
    </div>;
  }
  return <div className="nc-music-art"><Vinyl song={item.song} spinning={spinning} /></div>;
}

function Vinyl({ song, spinning = false }: { song: Song; spinning?: boolean }) {
  return <div className={`nc-disc ${spinning ? 'nc-spinning' : ''}`}><Cover src={song.cover} seed={song.id || song.name} /><i className="nc-spindle" /></div>;
}
