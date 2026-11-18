'use client';
import { useState } from 'react';
import { musicSources } from '@/lib/music-ids';
import { useApp } from '@/lib/app';
import type { MusicPreference, MusicProvider, Song } from '@/lib/types';
import { Sheet } from './Sheet';

const providers: MusicProvider[] = ['netease', 'qq'];
const names: Record<MusicProvider, string> = { netease: '网易云', qq: 'QQ 音乐' };
const songProviders = (song: Song) => providers.filter(provider => musicSources(song).some(source => source.provider === provider));

export function ProviderIcon({ provider, decorative = false }: { provider: MusicProvider; decorative?: boolean }) {
  return <span className={`music-provider ${provider}`} role={decorative ? undefined : "img"} title={names[provider]} aria-label={decorative ? undefined : names[provider]} aria-hidden={decorative || undefined}>
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {provider === 'netease' ? <><circle cx="10" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v9a2.4 2.4 0 1 1-2.4-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></> : <><path d="M8 3v10m0-8 7-2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><ellipse cx="5.6" cy="14" rx="2.7" ry="2" fill="currentColor" /><ellipse cx="12.6" cy="12" rx="2.7" ry="2" fill="currentColor" /></>}
    </svg>
  </span>;
}

export function MusicSources({ song, className = '' }: { song: Song; className?: string }) {
  const available = songProviders(song), label = available.map(provider => names[provider]).join(' · ');
  return available.length ? <span className={`music-sources ${className}`} title={`收录来源：${label}`}>{available.map(provider => <ProviderIcon key={provider} provider={provider} />)}</span> : null;
}

export function PlaybackSource({ quality }: { quality: string }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const available = app.current ? songProviders(app.current) : [];
  const actual = app.audioInfo?.provider;
  const provider = actual ?? (available.length === 1 ? available[0] : undefined);
  const label = [quality, provider ? names[provider] : ''].filter(Boolean).join(' · ');
  const indicator = <>{provider && <ProviderIcon provider={provider} />}{quality && <span>{quality}</span>}</>;

  if (available.length < 2) return label ? <span className="playback-source-label" title={label}>{indicator}</span> : null;

  const choices: MusicPreference[] = ['auto', ...available];
  return <>
    <button className="playback-source-button" type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`播放音源：${label || '自动选择'}`} title={label || '播放音源'}
      onClick={event => { event.stopPropagation(); setOpen(true); }}>
      {provider || quality ? indicator : '播放音源'} <span aria-hidden="true">⌄</span>
    </button>
    {open && <Sheet title="播放音源" onClose={() => setOpen(false)}>
      <div className="playback-source-choices">{choices.map(choice => (
        <button key={choice} className={`btn ghost ${choice === app.playbackSource ? 'selected' : ''}`}
          type="button" aria-pressed={choice === app.playbackSource}
          onClick={() => { app.setPlaybackSource(choice); setOpen(false); }}>
          <span className="row">{choice !== 'auto' && <ProviderIcon provider={choice} decorative />}{choice === 'auto' ? '自动' : names[choice]}</span>
          {actual === choice && <span className="sub sm">正在播放</span>}
        </button>
      ))}</div>
    </Sheet>}
  </>;
}
