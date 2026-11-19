import type { ReactNode } from 'react';

export const GRAFFITI_LESSON_IMAGE = '/canvas-graffiti/record-practice.png';
export const GRAFFITI_LESSON_COVERAGE = 80;

export type LayerGuide = 'intro' | 'import' | 'separate' | 'select' | 'pick' | 'mix' | 'spray' | 'complete';

const steps = {
  intro: ['把图片喷到墙上', '导入一张图，按颜色分层，再一层层喷出自己的版本。'],
  import: ['导入图片', '选一张自己的图，或者用示例唱片开始。'],
  separate: ['按颜色分层', '点「颜色分层」，把图片里的颜色拆成能单独喷涂的区域。'],
  select: ['选择颜色层', '点一个还没喷过的色块，墙面会显示这一层能喷的位置。'],
  pick: ['一键取色', '点「给当前罐取色」，把这个图层的颜色装进手里的喷漆罐。'],
  mix: ['调出自己的颜色', '调整当前罐的颜色，或点「套用配色」。调好后点上方按钮开始喷。'],
  spray: ['喷涂这一层', '按住模板来回喷涂，松开后查看进度。'],
  complete: ['作品完成', '可以把成品贴到共享画布，也可以结束这次练习。'],
} as const satisfies Record<LayerGuide, readonly [string, string]>;

export function GraffitiLayerGuide({ stage, coverage, painted, total, busy, children, onExit }: {
  stage: LayerGuide;
  coverage: number;
  painted: number;
  total: number;
  busy: boolean;
  children?: ReactNode;
  onExit: () => void;
}) {
  const [title, instruction] = steps[stage];
  return <section className="nc-graffiti-lesson" aria-label="图片涂鸦教程">
    <div className="nc-graffiti-lesson-heading">
      {(stage === 'intro' || stage === 'import') && <img src={GRAFFITI_LESSON_IMAGE} width={44} height={44} alt="示例唱片" />}
      <div className="nc-graffiti-lesson-copy" aria-live="polite">
        <b>{title}</b>
        <p className="sub sm">{instruction}</p>
      </div>
      <button className="btn ghost sm nc-graffiti-lesson-exit" type="button" disabled={busy} onClick={onExit}>
        {stage === 'intro' ? '跳过' : stage === 'complete' ? '结束练习' : '退出练习'}
      </button>
    </div>
    {stage === 'spray' && <div className="nc-graffiti-lesson-progress">
      <progress aria-label="当前图层喷涂进度" value={Math.min(coverage, GRAFFITI_LESSON_COVERAGE)} max={GRAFFITI_LESSON_COVERAGE}>
      </progress>
      <span className="sub sm">{painted}/{total} 层已完成</span>
    </div>}
    {children && <div className="nc-graffiti-lesson-controls">{children}</div>}
  </section>;
}
