'use client';
import { useState } from 'react';
import { musicSources } from '@/lib/music-ids';
import { useApp } from '@/lib/app';
import type { MusicPreference, MusicProvider, Song } from '@/lib/types';
import { Sheet } from './Sheet';

const providers: MusicProvider[] = ['netease', 'qq'];
const names: Record<MusicProvider, string> = { netease: '网易云', qq: 'QQ 音乐' };
const songProviders = (song: Song) => providers.filter(provider => musicSources(song).some(source => source.provider === provider));

export function MusicSources({ song, className = '' }: { song: Song; className?: string }) {
  const label = songProviders(song).map(provider => names[provider]).join(' · ');
  return label ? <span className={`music-sources ${className}`} title={`收录来源：${label}`}>{label}</span> : null;
}

export function PlaybackSource({ quality }: { quality: string }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const available = app.current ? songProviders(app.current) : [];
  const actual = app.audioInfo?.provider;
  const provider = actual ?? (available.length === 1 ? available[0] : undefined);
  const label = [quality, provider ? names[provider] : ''].filter(Boolean).join(' · ');

  if (available.length < 2) return label ? <span className="playback-source-label">{label}</span> : null;

  const choices: MusicPreference[] = ['auto', ...available];
  return <>
    <button className="playback-source-button" type="button" aria-haspopup="dialog" aria-expanded={open}
      onClick={event => { event.stopPropagation(); setOpen(true); }}>
      {label || '播放音源'} <span aria-hidden="true">⌄</span>
    </button>
    {open && <Sheet title="播放音源" onClose={() => setOpen(false)}>
      <div className="playback-source-choices">{choices.map(choice => (
        <button key={choice} className={`btn ghost ${choice === app.playbackSource ? 'selected' : ''}`}
          type="button" aria-pressed={choice === app.playbackSource}
          onClick={() => { app.setPlaybackSource(choice); setOpen(false); }}>
          <span>{choice === 'auto' ? '自动' : names[choice]}</span>
          {actual === choice && <span className="sub sm">正在播放</span>}
        </button>
      ))}</div>
    </Sheet>}
  </>;
}
