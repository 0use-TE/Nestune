'use client';

import { useEffect, useRef } from 'react';
import type { Point } from '@/lib/canvas-graffiti';

export const GUIDE_LOGO_LAYERS = [
  { name: '外圈', path: 'M50 10a40 40 0 1 0 0 80a40 40 0 1 0 0-80ZM50 17a33 33 0 1 1 0 66a33 33 0 1 1 0-66Z',
    color: '#252422', instruction: '选一罐深色，沿着墙面模板的镂空圆圈喷一遍。' },
  { name: '阴影', path: 'M62 28 34 57H52L46 79 77 47H58Z',
    color: '#3679d6', instruction: '换一罐颜色，喷满偏下一点的闪电，给标志加一层阴影。' },
  { name: '主体', path: 'M55 23 27 52H45L39 74 70 42H51Z',
    color: '#edaf35', instruction: '换一罐亮色，喷满上面的闪电。刚才的阴影会从它的边缘露出来。' },
] as const;

export type LayerGuide = { stage: 'intro' } | { stage: 'practice'; step: number; position: Point; painted: boolean } | { stage: 'complete' };

export function GraffitiLayerGuide({ guide, onStart, onNext, onExit }: {
  guide: LayerGuide; onStart: () => void; onNext: () => void; onExit: () => void;
}) {
  const reference = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = reference.current?.getContext('2d');
    if (!context) return;
    for (const layer of GUIDE_LOGO_LAYERS) {
      context.fillStyle = layer.color;
      context.fill(new Path2D(layer.path), 'evenodd');
    }
  }, []);

  const step = guide.stage === 'practice' ? GUIDE_LOGO_LAYERS[guide.step] : null;
  const last = guide.stage === 'practice' && guide.step === GUIDE_LOGO_LAYERS.length - 1;
  return <section className="nc-graffiti-lesson" aria-label="涂鸦分层教程">
    <canvas ref={reference} width={100} height={100} role="img" aria-label="示例闪电标志" />
    <div className="nc-graffiti-lesson-copy" aria-live="polite">
      <b>{guide.stage === 'intro' ? '用涂鸦做个闪电标志' : guide.stage === 'practice'
        ? `${guide.step + 1}/${GUIDE_LOGO_LAYERS.length} · ${step?.name}` : '练习完成'}</b>
      <p className="sub sm">{step?.instruction ?? (guide.stage === 'intro'
        ? '用三张模板亲手喷出外圈、阴影和主体。' : '看看墙上三层叠起来的效果。开始自由涂鸦时会清空这幅练习。')}</p>
    </div>
    <div className="nc-graffiti-lesson-actions">
      {guide.stage === 'intro' && <button className="btn sm" type="button" onClick={onStart}>开始练习</button>}
      {guide.stage === 'practice' && <button className="btn sm" type="button" disabled={!guide.painted}
        onClick={onNext}>{last ? '查看成品' : '下一层'}</button>}
      <button className={`btn sm ${guide.stage !== 'complete' ? 'ghost' : ''}`} type="button" onClick={onExit}>
        {guide.stage === 'intro' ? '跳过' : guide.stage === 'practice' ? '退出练习' : '开始自由涂鸦'}
      </button>
    </div>
  </section>;
}
