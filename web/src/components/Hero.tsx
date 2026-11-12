'use client';
import { useEffect, useState } from 'react';
import { loadTint, seededTint } from '@/lib/util';
import { Cover } from './Cover';

/** Large banner whose colours come from its own cover. */
export function Hero({ cover, seed, tag, title, sub, children, round }: {
  cover?: string | null; seed: string | number; tag?: string; title: string; sub?: React.ReactNode; children?: React.ReactNode; round?: boolean;
}) {
  const [t, setT] = useState<[string, string]>(() => seededTint(seed));
  useEffect(() => {
    let live = true;
    setT(seededTint(seed));
    loadTint(cover, seed).then(x => live && setT(x));
    return () => { live = false; };
  }, [cover, seed]);
  return (
    <div className="hero" style={{ ['--c1' as string]: t[0], ['--c2' as string]: t[1] }}>
      <Cover src={cover} seed={seed} className={round ? 'round' : ''} />
      <div className="in">
        {tag && <span className="tag">{tag}</span>}
        <h1>{title}</h1>
        {sub && <div style={{ opacity: .85 }}>{sub}</div>}
        {children && <div className="row" style={{ marginTop: 22 }}>{children}</div>}
      </div>
    </div>
  );
}
