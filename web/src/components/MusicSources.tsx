'use client';
import { musicSources } from '@/lib/music-ids';
import { useApp } from '@/lib/app';
import type { MusicProvider, Song } from '@/lib/types';

const names: Record<MusicProvider, string> = { netease: '网易云音乐', qq: 'QQ 音乐' };
export function ProviderIcon({ provider }: { provider: MusicProvider }) {
  return <span className={`music-provider ${provider}`} title={names[provider]} aria-label={names[provider]}>
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {provider === 'netease' ? <><circle cx="10" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v9a2.4 2.4 0 1 1-2.4-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></> : <><path d="M8 3v10m0-8 7-2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><ellipse cx="5.6" cy="14" rx="2.7" ry="2" fill="currentColor" /><ellipse cx="12.6" cy="12" rx="2.7" ry="2" fill="currentColor" /></>}
    </svg>
  </span>;
}
export function MusicSources({ song }: { song: Song }) {
  const providers = [...new Set(musicSources(song).map(s => s.provider))];
  if (!providers.length) return null;
  return <span className="music-sources">{providers.map(p => <ProviderIcon key={p} provider={p} />)}</span>;
}
export function PlaybackSource() {
  const app = useApp();
  if (!app.current || !musicSources(app.current).length) return null;
  const actual = app.audioInfo?.provider;
  return <label className="playback-source" onClick={e => e.stopPropagation()}>
    {actual && <ProviderIcon provider={actual} />}
    <select aria-label="播放音源" value={app.playbackSource} onChange={e => app.setPlaybackSource(e.target.value as 'auto' | MusicProvider)}>
      <option value="auto">自动选择音源</option>
      {[...new Set(musicSources(app.current).map(s => s.provider))].map(p => <option key={p} value={p}>{names[p]}</option>)}
    </select>
  </label>;
}
