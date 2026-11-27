'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@/lib/types';
import { groupTasteAlbums, type TasteMap, type TasteSelection, type TasteTrack } from '@/lib/taste-map';
import { registerOverlay } from '@/lib/overlays';
import { MusicArtwork } from './MusicArtwork';
import { Icon } from './Icon';
import TasteGraph from './TasteGraph';
import styles from './taste-atlas.module.css';

type Props = { map: TasteMap; onPlay?: (songs: Song[]) => void };

export default function TasteAtlas({ map, onPlay }: Props) {
  const [selection, setSelection] = useState<TasteSelection | null>(null);
  const [freshOnly, setFreshOnly] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const albums = useMemo(() => groupTasteAlbums(map.tracks), [map]);
  const albumNodes = useMemo(() => {
    const ranked = [...albums.entries()].sort((a, b) => b[1].length - a[1].length);
    return ranked.slice(0, 6).map(([id, members]) => ({
      song: { ...members[0].song, id, name: members[0].song.album.name },
      centerIds: [...new Set(members.flatMap(t => t.centerIds))], reason: '',
    }));
  }, [albums]);
  const graph = useMemo(() => ({ ...map, tracks: [...map.tracks, ...albumNodes] }), [map, albumNodes]);
  const mix = useMemo(() => {
    const byId = new Map(map.tracks.map(track => [track.song.id, track]));
    return map.mixIds.flatMap(id => byId.get(id) ?? []);
  }, [map]);
  function close() {
    setSelection(null);
    if (selection && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (selection) return registerOverlay(close, 'page');
  }, [selection]);
  function select(next: TasteSelection) {
    if (!selection && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
    setSelection(next);
  }
  function detail(selection: TasteSelection, pinned: boolean) {
    const center = selection.kind === 'center' ? map.centers.find(c => c.id === selection.id) : undefined;
    const track = selection.kind === 'song' ? map.tracks.find(t => t.song.id === selection.id) : undefined;
    const album = selection.kind === 'album' ? albums.get(selection.id) : undefined;
    const freshMix = mix.filter(t => t.unheard);
    const tracks = track ? [track] : album ?? (center ? map.tracks.filter(t => t.centerIds.includes(center.id)) : freshOnly ? freshMix : mix);
    const title = track?.song.name ?? album?.[0].song.album.name ?? center?.label ?? '为你推荐';
    const category = track ? '单曲' : album ? '专辑' : center ? center.kind === 'artist' ? '歌手' : center.kind === 'tag' ? '曲风' : '探索' : '推荐歌单';
    const albumOfSong = track && [...albums].find(([, members]) => members.includes(track));
    function showSong(t: TasteTrack) {
      select({ kind: 'song', id: t.song.id });
    }
    return <section className={styles.inspector} aria-label={pinned ? "星图详情" : "作品预览"}>
        <header className={styles.detailHead}><span>{category}</span>{pinned && <button type="button" onClick={close} aria-label="关闭详情">×</button>}</header>
        <div className={styles.summary}>
          {tracks.length > 0 && (track || album) && <div className={styles.thumb}><MusicArtwork item={{
            kind: track ? 'song' : album ? 'album' : 'playlist', song: tracks[0].song, name: title, tracks: tracks.map(t => t.song),
          }} /></div>}
          <div><h3>{title}</h3><small>{track ? track.song.artists.map(a => a.name).join(' / ') : (album ? '星图收录 ' : '') + tracks.length + ' 首' + (selection.kind === 'mix' && !freshOnly && freshMix.length ? ' · ' + freshMix.length + ' 首未听' : '')}</small></div>
        </div>
        {selection.kind === 'mix' && freshMix.length > 0 && freshMix.length < mix.length &&
          <button type="button" className={styles.freshFilter} aria-pressed={freshOnly} onClick={() => setFreshOnly(!freshOnly)}>只看未听过的歌</button>}
        {pinned && onPlay && !!tracks.length && <button type="button" className={styles.play} onClick={() => onPlay(tracks.map(t => t.song))}><Icon n="play" s={15} />{track ? '播放歌曲' : '播放全部'}</button>}
        {(track || album) && <small className={styles.albumName}>{track ? track.song.album.name : album?.[0].song.artists.map(a => a.name).join(' / ')}</small>}
        {(!pinned || album) && <p className={styles.previewReason}>{track?.reason || album?.[0]?.reason}</p>}
        {pinned && (track ? <div className={styles.reason}>
          <p>{track.unheard && <strong className={styles.fresh}>未听过</strong>}{track.reason}</p>
          <div className={styles.tags}>{map.centers.filter(c => track.centerIds.includes(c.id)).map(c =>
            <button type="button" key={c.id} onClick={() => select({ kind: 'center', id: c.id })}>{c.label}</button>)}</div>
          {albumOfSong && <button type="button" className={styles.albumLink} onClick={() => { select({ kind: 'album', id: albumOfSong[0] }); }}>查看专辑《{track.song.album.name}》 ↗</button>}
        </div> : <ol className={styles.tracks}>{tracks.map((t, i) => <li key={t.song.id}><button type="button" onClick={() => showSong(t)} aria-label={`查看《${t.song.name}》`}>
          <span className={styles.rowNumber}>{i + 1}</span>
          <span><b>{t.song.name}</b><small>{t.song.artists.map(a => a.name).join(' / ')}</small></span>{t.unheard ? <i className={styles.fresh}>未听</i> : <i>↗</i>}
        </button></li>)}</ol>)}

    </section>;
  }
  return <section className={styles.atlas} aria-label="音乐星图">
    <div className={styles.stage}>
      <TasteGraph map={graph} mix={mix} albums={albums}
        selection={selection} onSelect={select} onClose={close} renderDetail={detail} />

    </div>
  </section>;
}
