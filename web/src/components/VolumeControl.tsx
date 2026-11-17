'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/app';
import { Icon } from './Icon';

export function VolumeControl({ inline = false }: { inline?: boolean }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const percent = Math.round(app.volume * 100);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', close); };
  }, [open]);
  const controls = <>
    <button type="button" className="ib" onClick={app.toggleMute} aria-label={percent ? '静音' : '取消静音'} title={percent ? '静音' : '取消静音'}><Icon n={percent ? 'vol' : 'muted'} s={19} /></button>
    <input type="range" min={0} max={100} step={1} value={percent} aria-label="播放音量" aria-valuetext={`${percent}%`} onChange={event => app.setVolume(Number(event.target.value) / 100)} />
    <output aria-live="off">{percent}%</output>
  </>;
  if (inline) return <div className="volume-inline">{controls}</div>;
  return <>
    <button ref={trigger} type="button" className={`ib volume-toggle ${open ? 'act' : ''}`} aria-label={`音量 ${percent}%`} title={`音量 ${percent}%`} aria-expanded={open} aria-haspopup="dialog" onClick={() => {
      if (trigger.current) {
        const bounds = trigger.current.getBoundingClientRect();
        const theme = getComputedStyle(trigger.current);
        const vars = Object.fromEntries(['--surface', '--text', '--sub', '--line', '--soft'].map(key => [key, theme.getPropertyValue(key)]));
        setPosition({ ...vars, left: Math.max(8, Math.min(bounds.left - 90, innerWidth - 232)), bottom: Math.max(8, innerHeight - bounds.top + 10) });
      }
      setOpen(value => !value);
    }}><Icon n={percent ? 'vol' : 'muted'} s={19} /></button>
    {open && createPortal(<div ref={popup} className="volume-popover" role="dialog" aria-label="调节音量" style={position}>
      <div className="volume-popover-heading"><b>播放音量</b><button type="button" className="ib" aria-label="关闭音量调节" onClick={() => { setOpen(false); trigger.current?.focus(); }}><Icon n="x" s={14} /></button></div>
      <div className="volume-inline">{controls}</div>
    </div>, document.body)}
  </>;
}
