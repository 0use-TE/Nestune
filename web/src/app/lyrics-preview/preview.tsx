'use client';
import { useEffect, useMemo, useState } from 'react';
import { Cover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { PlayerLyrics } from '@/components/PlayerLyrics';
import { FloatingLyrics } from '@/components/FloatingLyrics';
import { KaraokeText } from '@/components/KaraokeText';
import type { LyricLine } from '@/lib/types';
import { mmss } from '@/lib/util';

// Original demonstration text and deliberately uneven syllable timings.
const TEXT = [
  ['让音乐慢慢流过', 'Let the music drift through'],
  ['蓝色的风吹向暖黄的梦', 'A blue breeze, a golden dream'],
  ['沿着这束光再回到你身旁', 'Follow this light back to your side'],
  ['把这一刻轻轻收藏', 'Keep this moment close'],
  ['不着急就这样跟着旋律走让心事随风飘远', 'Take your time, follow the melody'],
  ['让音乐慢慢流过', 'Let the music drift through'],
];
const LINES: LyricLine[] = TEXT.map(([text, tr], index) => {
  const characters = [...text], weights = characters.map((_, i) => i % 4 === 2 ? 1.8 : i % 3 === 0 ? .65 : 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let t = index * 7 + .4;
  return { t, d: 5.8, text, tr, words: characters.map((text, i) => {
    const d = weights[i] / total * 5.4; const word = { t, d, text }; t += d + .4 / characters.length; return word;
  }) };
});
const DURATION = 42;

export function LyricsPreview() {
  const [flowSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const [time, setTime] = useState(2.6), [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<'word' | 'line' | 'original'>('word');
  const [floating, setFloating] = useState(false), [translation, setTranslation] = useState(true);
  const [dark, setDark] = useState(true);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const interval = setInterval(() => { const now = performance.now(), delta = (now - previous) / 1000; previous = now; setTime(value => (value + delta) % DURATION); }, 80);
    return () => clearInterval(interval);
  }, [playing]);
  const lines = useMemo(() => mode === 'line' ? LINES.map(({ words, d, ...line }) => line) : LINES, [mode]);
  let active = -1; for (let i = 0; i < lines.length && lines[i].t <= time; i++) active = i;
  const current = lines[active];
  const jump = (offset: number) => setTime(lines[Math.max(0, Math.min(lines.length - 1, active + offset))].t);
  return <div className="lyrics-preview">
    <header className="preview-toolbar">
      <span className="preview-label">歌词效果预览 <small>仅本地</small></span>
      <div className="preview-modes" aria-label="歌词效果">
        {([['word', '逐字流光'], ['line', '整句扫色'], ['original', '原版对比']] as const).map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
      </div>
      <button className="ib" title="切换明暗" aria-label="切换明暗" onClick={() => setDark(!dark)}><Icon n="opacity" s={17} /></button>
    </header>
    <div id="np" className="open preview-np" data-mobile-page="playback" data-playing={playing || undefined}>
      <div className="np-playback-page">
        <div className="left">
          <div className="np-art"><div className="np-record"><Cover seed={0} /></div></div>
          <div className="np-details">
            <div className="np-info"><h1>慢慢流过</h1><div className="np-meta sub">Nestune · 歌词效果演示</div></div>
            <div className="np-bottom">
              <div className="np-progress">
                <input className="preview-progress" type="range" min={0} max={DURATION} step={.01} value={time} aria-label="播放进度" onChange={event => setTime(Number(event.target.value))} />
                <div className="times sub sm"><span>{mmss(time)}</span><span>演示歌词 · 无音频</span><span>{mmss(DURATION)}</span></div>
              </div>
              <div className="ctl">
                <button className="ib" aria-label="上一句" onClick={() => jump(-1)}><Icon n="prev" s={22} /></button>
                <button className="ib play" aria-label={playing ? '暂停演示' : '播放演示'} onClick={() => setPlaying(!playing)}><Icon n={playing ? 'pause' : 'play'} /></button>
                <button className="ib" aria-label="下一句" onClick={() => jump(1)}><Icon n="next" s={22} /></button>
              </div>
              <div className="np-tools">
                <button className={`ib ${translation ? 'act' : ''}`} aria-label="翻译" aria-pressed={translation} onClick={() => setTranslation(!translation)}><Icon n="translation" s={18} /></button>
                <button className={`ib ${floating ? 'act' : ''}`} aria-label="悬浮歌词" aria-pressed={floating} onClick={() => setFloating(!floating)}><Icon n="lyrics" s={18} /></button>
              </div>
              <p className="preview-help">点一句可跳转 · 拖动进度可回看{floating ? ' · 浮窗可拖动' : ''}</p>
            </div>
          </div>
        </div>
        <div className="np-stage">
          <PlayerLyrics flowSeed={flowSeed} lines={lines} active={active} position={time} playing={playing} duration={DURATION} karaoke={mode !== 'original'} status={null} showTranslation={translation} onSeek={setTime} onBackgroundClick={() => {}} />
        </div>
      </div>
    </div>
    <FloatingLyrics visible={floating} text={current ? mode === 'original' ? current.text : <KaraokeText flowSeed={flowSeed} line={current} position={time} playing={playing} nextTime={lines[active + 1]?.t} duration={DURATION} /> : '前奏'} translation={translation ? current?.tr : undefined} onClose={() => setFloating(false)} />
  </div>;
}
