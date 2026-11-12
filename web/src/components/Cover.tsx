/* eslint-disable @next/next/no-img-element */
import { PAL, SHAPES, hashSeed } from '@/lib/util';

/** Real cover when we have one; otherwise a generated geometric cover seeded by the id. */
export function Cover({ src, seed, className = '' }: { src?: string | null; seed: string | number; className?: string }) {
  if (src) {
    return <div className={`cv ${className}`}><img src={src} alt="" loading="lazy" draggable={false} /></div>;
  }
  const h = hashSeed(seed), p = PAL[h % PAL.length];
  return (
    <div className={`cv ${className}`} style={{ ['--c1' as string]: p[0], ['--c2' as string]: p[1] }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" dangerouslySetInnerHTML={{ __html: SHAPES[(h >>> 3) % SHAPES.length](p[2]) }} />
    </div>
  );
}

export function Avatar({ src, name, large }: { src?: string | null; name: string; large?: boolean }) {
  return (
    <span className={`avatar ${large ? 'lg' : ''}`}>
      {src ? <img src={src} alt="" /> : (name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
