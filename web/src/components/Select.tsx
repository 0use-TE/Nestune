'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { registerOverlay } from '@/lib/overlays';
import { Icon } from './Icon';

type Option = { value: string | number; label: string; disabled?: boolean };
type Props = {
  value: string | number;
  options: Option[];
  onChange: (value: string) => void;
  'aria-label': string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
};

/** One themed listbox for mouse, touch and keyboard, including clipped panels. */
export function Select({ value, options, onChange, disabled, autoFocus, id, 'aria-label': label }: Props) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const selected = options.findIndex(option => String(option.value) === String(value));

  function show() {
    if (disabled || !options.some(option => !option.disabled)) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : options.findIndex(option => !option.disabled));
    search.current = { text: '', at: 0 };
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (String(option.value) !== String(value)) onChange(String(option.value));
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Enter' || (event.key === ' ' && Date.now() - search.current.at > 650)) {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show();
        if (event.key === 'Home') setActive(options.findIndex(option => !option.disabled));
        if (event.key === 'End') setActive(options.findLastIndex(option => !option.disabled));
        return;
      }
      const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      const offset = available.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (offset + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
      setActive(available[next] ?? -1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!open) show();
      const now = Date.now();
      const text = (now - search.current.at < 650 ? search.current.text : '') + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const ordered = options.map((_, index) => (index + Math.max(active, 0) + 1) % options.length);
      const match = ordered.find(index => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(text));
      if (match !== undefined) setActive(match);
    }
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) return registerOverlay(() => setOpen(false)); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const view = window.visualViewport;
      const leftEdge = (view?.offsetLeft ?? 0) + 12, topEdge = (view?.offsetTop ?? 0) + 12;
      const rightEdge = leftEdge + (view?.width ?? window.innerWidth) - 24;
      const bottomEdge = topEdge + (view?.height ?? window.innerHeight) - 24;
      const width = Math.min(Math.max(bounds.width, 160), rightEdge - leftEdge);
      const below = bottomEdge - bounds.bottom - 6, above = bounds.top - topEdge - 6;
      const up = below < Math.min(240, options.length * 42 + 12) && above > below;
      const maxHeight = Math.max(40, Math.min(280, up ? above : below));
      const height = Math.min(maxHeight, popup.current?.scrollHeight ?? maxHeight);
      setPosition({ width, maxHeight, left: Math.max(leftEdge, Math.min(bounds.left, rightEdge - width)),
        top: up ? Math.max(topEdge, bounds.top - height - 6) : Math.max(topEdge, bounds.bottom + 6) });
    };
    place();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  return <>
    <button ref={trigger} id={id} type="button" className="select-trigger" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      disabled={disabled} autoFocus={autoFocus} onKeyDown={keyDown} onClick={() => open ? setOpen(false) : show()}>
      <span>{options[selected]?.label ?? '请选择'}</span><Icon n="down" s={15} />
    </button>
    {open && createPortal(<div ref={popup} id={listId} role="listbox" aria-label={label} className="select-options" style={position}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={index === selected} aria-disabled={option.disabled || undefined}
        className={`select-option${index === active ? ' is-active' : ''}`}
        onPointerMove={event => { if (event.pointerType === 'mouse' && !option.disabled) setActive(index); }}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === selected && <Icon n="check" s={16} />}
      </div>)}
    </div>, document.body)}
  </>;
}
