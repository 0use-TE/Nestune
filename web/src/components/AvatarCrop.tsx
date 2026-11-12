'use client';
import { Loading } from './Loading';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

type Point = { x: number; y: number };
const CENTER = { x: 0, y: 0 };
const OUTPUT = 512;

export function AvatarCrop({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (blob: Blob) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>(CENTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const image = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; from: Point; offset: Point; size: number } | null>(null);

  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    const previous = document.activeElement;
    frame.current?.focus();
    return () => {
      URL.revokeObjectURL(preview);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [file]);

  const scale = dimensions ? zoom / Math.min(dimensions.width, dimensions.height) : 1;
  const width = dimensions ? dimensions.width * scale : 1;
  const height = dimensions ? dimensions.height * scale : 1;
  const clamp = (point: Point, w = width, h = height) => ({
    x: Math.max((1 - w) / 2, Math.min((w - 1) / 2, point.x)),
    y: Math.max((1 - h) / 2, Math.min((h - 1) / 2, point.y)),
  });

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!dimensions || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, from: { x: event.clientX, y: event.clientY }, offset, size: event.currentTarget.clientWidth };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    setOffset(clamp({ x: active.offset.x + (event.clientX - active.from.x) / active.size, y: active.offset.y + (event.clientY - active.from.y) / active.size }));
  }
  function end(event: PointerEvent<HTMLDivElement>) { if (drag.current?.id === event.pointerId) drag.current = null; }

  async function save() {
    if (!image.current || !dimensions || busy) return;
    setBusy(true); setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = OUTPUT;
      const context = canvas.getContext('2d');
      if (!context) throw Error('无法裁剪这张图片');
      context.drawImage(image.current, ((1 - width) / 2 + offset.x) * OUTPUT, ((1 - height) / 2 + offset.y) * OUTPUT, width * OUTPUT, height * OUTPUT);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw Error('无法导出裁剪后的头像');
      await onSave(blob);
    } catch (e) { setError(e instanceof Error ? e.message : '保存头像失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mask" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <section className="modal avatar-crop" role="dialog" aria-modal="true" aria-label="裁剪头像" onKeyDown={e => {
        if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); }
        if (e.key === 'Tab') {
          const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"],input:not(:disabled),button:not(:disabled)'));
          const boundary = e.shiftKey ? focusable[0] : focusable.at(-1);
          if (document.activeElement === boundary) { e.preventDefault(); (e.shiftKey ? focusable.at(-1) : focusable[0])?.focus(); }
        }
      }}>
        <h2>裁剪头像</h2>
        <div ref={frame} className="avatar-crop-frame" tabIndex={0} aria-label="头像预览，拖动或用方向键调整位置"
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={e => {
            const dx = e.key === 'ArrowRight' ? .025 : e.key === 'ArrowLeft' ? -.025 : 0;
            const dy = e.key === 'ArrowDown' ? .025 : e.key === 'ArrowUp' ? -.025 : 0;
            if (dx || dy) { e.preventDefault(); setOffset(clamp({ x: offset.x + dx, y: offset.y + dy })); }
          }}>
          {url && <img ref={image} src={url} alt="" draggable={false} onLoad={e => setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setError('无法读取图片，请选择 PNG、JPG 或 WebP')} style={{ width: width * 100 + '%', height: height * 100 + '%', left: (offset.x + .5) * 100 + '%', top: (offset.y + .5) * 100 + '%', visibility: dimensions ? 'visible' : 'hidden' }} />}
        </div>
        <label className="avatar-crop-zoom">缩放<input type="range" min={1} max={3} step={.01} value={zoom} disabled={!dimensions || busy} onChange={e => {
          const next = Number(e.target.value);
          setOffset(clamp(offset, width * next / zoom, height * next / zoom)); setZoom(next);
        }} /></label>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row avatar-crop-actions"><button className="btn ghost sm" disabled={busy} onClick={onCancel}>取消</button><button className="btn sm" disabled={busy || !dimensions} onClick={save}>{busy ? <Loading inline label="保存中" /> : '使用此头像'}</button></div>
      </section>
    </div>
  );
}
