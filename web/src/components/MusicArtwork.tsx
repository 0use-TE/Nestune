import type { CanvasRecord } from '@/lib/canvas-types';
import type { Song } from '@/lib/types';
import { Cover } from './Cover';

type ArtworkItem = Pick<CanvasRecord, 'kind' | 'song' | 'name' | 'tracks'>;

export function MusicArtwork({ item, spinning = false }: { item: ArtworkItem; spinning?: boolean }) {
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
}

function Vinyl({ song, spinning = false }: { song: Song; spinning?: boolean }) {
  return <div className={`nc-disc ${spinning ? 'nc-spinning' : ''}`}><Cover src={song.cover} seed={song.id || song.name} /><i className="nc-spindle" /></div>;
}
