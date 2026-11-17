'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { LyricLine } from '@/lib/types';
import { karaokeFlow, karaokeWords, wordProgress } from '@/lib/karaoke';

export function KaraokeText({ line, position, playing, nextTime, duration, flowSeed = 0 }: {
  line: LyricLine; position: number; playing: boolean; nextTime?: number; duration?: number; flowSeed?: number;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const words = useMemo(() => karaokeWords(line, nextTime, duration), [line, nextTime, duration]);
  const flow = useMemo(() => karaokeFlow(line, flowSeed), [line, flowSeed]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView!;
    const pieces = [...element.querySelectorAll<HTMLElement>('.karaoke-word')];
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--lyric-width', `${Math.max(1, bounds.width) * 2}px`);
      pieces.forEach(piece => piece.style.setProperty('--word-x', `${piece.getBoundingClientRect().left - bounds.left}px`));
    };
    measure();
    const observer = new view.ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [words]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView!;
    const pieces = [...element.querySelectorAll<HTMLElement>('.karaoke-word')];
    const previous: number[] = [];
    const reduced = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = view.performance.now(); let frame = 0;
    const update = () => {
      const time = position + (playing ? (view.performance.now() - start) / 1000 : 0);
      words.forEach((word, index) => {
        const progress = Math.round(wordProgress(word, time) * 10000) / 100;
        if (previous[index] !== progress) { pieces[index]?.style.setProperty('--sung', `${progress}%`); previous[index] = progress; }
      });
      // Use the media clock for both fill and flow: pausing freezes them together.
      const drift = reduced ? 0 : -time * flow.speed * flow.direction;
      element.style.setProperty('--lyric-flow', `calc(var(--lyric-width,600px) * ${flow.phase} + ${drift}px)`);
      if (playing) frame = view.requestAnimationFrame(update);
    };
    update();
    return () => view.cancelAnimationFrame(frame);
  }, [words, position, playing, flow]);
  return <span className="karaoke-text" ref={root} data-timing={line.words?.length ? 'word' : 'line'}>
    {words.map((word, index) => <span className="karaoke-word" key={index}>
      <span className="karaoke-base">{word.text}</span><span className="karaoke-ink" aria-hidden="true">{word.text}</span>
    </span>)}
  </span>;
}
