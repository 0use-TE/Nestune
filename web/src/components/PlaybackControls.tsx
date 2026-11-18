'use client';
import type { PlaybackMode } from '@/lib/shared-queue';
import { Icon } from './Icon';

export const LYRICS_IDLE_MS = 3000;

const playbackModes = {
  off: ['repeatOff', '不循环'],
  all: ['repeat', '列表循环'],
  one: ['repeat', '单曲循环'],
  shuffle: ['shuffle', '随机播放'],
} as const;

export function PlaybackModeButton({ mode, onChange, className = '' }: {
  mode: PlaybackMode; onChange: () => void; className?: string;
}) {
  const [icon, label] = playbackModes[mode];
  return <button type="button" className={`ib mode-control ${mode !== 'off' ? 'act' : ''} ${className}`}
    aria-label={`切换播放模式，当前${label}`} title={label} onClick={onChange}>
    <Icon n={icon} />{mode === 'one' && <span className="mode-count" aria-hidden="true">1</span>}
  </button>;
}

export function LyricsPlaybackControls({ mode, playing, onControl }: {
  mode: PlaybackMode; playing: boolean; onControl: (action: 'mode' | 'previous' | 'toggle' | 'next') => void;
}) {
  return <>
    <PlaybackModeButton mode={mode} onChange={() => onControl('mode')} />
    <button type="button" className="ib" aria-label="上一首" title="上一首" onClick={() => onControl('previous')}><Icon n="prev" s={16} /></button>
    <button type="button" className="ib" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'} onClick={() => onControl('toggle')}><Icon n={playing ? 'pause' : 'play'} s={16} /></button>
    <button type="button" className="ib" aria-label="下一首" title="下一首" onClick={() => onControl('next')}><Icon n="next" s={16} /></button>
  </>;
}
