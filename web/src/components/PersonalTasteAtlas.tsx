'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { TasteMap } from '@/lib/taste-map';
import TasteAtlas from './TasteAtlas';
import styles from './taste-atlas.module.css';

export default function PersonalTasteAtlas() {
  const app = useApp();
  const owner = app.me?.id;
  const [result, setResult] = useState<{ owner: number; map?: TasteMap; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (owner === undefined) return;
    const controller = new AbortController();
    api<TasteMap>('/api/me/taste-map', { signal: controller.signal }).then(
      map => { if (!controller.signal.aborted) setResult({ owner, map }); },
      error => { if (!controller.signal.aborted) setResult({ owner, error: error instanceof Error ? error.message : '暂时无法生成星图' }); },
    );
    return () => controller.abort();
  }, [owner, attempt]);

  if (!owner) return null;
  const current = result?.owner === owner ? result : undefined;
  if (current?.map?.tracks.length) return <TasteAtlas key={owner} map={current.map} onPlay={songs => {
    if (songs.length === 1) app.playNow(songs[0]);
    else app.play(songs, 0);
  }} />;
  if (!current) return <section className={styles.loadingSky} aria-label="音乐星图"><p role="status">正在整理你的听歌偏好…</p></section>;
  return <section className={styles.empty} aria-label="音乐星图">
    <div><p role="status">{current.error ?? '听几首歌，或收藏你喜欢的歌曲，就能在这里看到自己的音乐星图。'}</p></div>
    {current.error ? <button type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>重试</button> : <Link href="/search">去找歌 ↗</Link>}
  </section>;
}
