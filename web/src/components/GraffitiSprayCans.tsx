import type { CSSProperties } from 'react';
import { SPRAY_CAN_IMPACT_OFFSETS, SPRAY_CAN_SHAKE_MS } from '@/lib/graffiti-spray-audio';

const faces = Array.from({ length: 20 }, (_, index) => {
  const angle = index * 18;
  return {
    '--face-angle': `${angle}deg`,
    '--face-shadow': (1 - Math.cos((angle + 32) * Math.PI / 180)) * .32,
  } as CSSProperties;
});

function shakeFrames(amplitude: number): Keyframe[] {
  const [lift, rebound, secondLift, secondRebound] = SPRAY_CAN_IMPACT_OFFSETS;
  return [
    { offset: 0, transform: 'none' },
    { offset: lift, transform: `translate(${-5 * amplitude}px, ${-16 * amplitude}px) rotate(${-18 * amplitude}deg)` },
    { offset: rebound, transform: `translate(${6 * amplitude}px, ${-3 * amplitude}px) rotate(${16 * amplitude}deg)` },
    { offset: .44, transform: 'none' },
    { offset: secondLift, transform: `translate(${-4 * amplitude}px, ${-15 * amplitude}px) rotate(${-17 * amplitude}deg)` },
    { offset: secondRebound, transform: `translate(${5 * amplitude}px, ${-3 * amplitude}px) rotate(${14 * amplitude}deg)` },
    { offset: 1, transform: 'none' },
  ];
}

const fullShake = shakeFrames(1);
const gentleShake = shakeFrames(.48);

export function GraffitiSprayCans({ colors, selected, onSelect }: {
  colors: string[]; selected: number; onSelect: (index: number) => boolean;
}) {
  return <div className="nc-spray-rack" role="group" aria-label="喷漆罐">
    {colors.map((color, index) => <button className="nc-spray-can" key={index} type="button"
      aria-label={`喷漆罐 ${index + 1}，${color.toUpperCase()}`} title={color.toUpperCase()}
      aria-pressed={selected === index} style={{ '--can-color': color } as CSSProperties} onClick={event => {
        if (!onSelect(index)) return;
        const shaker = event.currentTarget.querySelector('.nc-spray-can-shaker');
        if (!shaker) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const animation of shaker.getAnimations()) animation.cancel();
        shaker.animate(reduced ? gentleShake : fullShake, { duration: SPRAY_CAN_SHAKE_MS });
      }}>
      <span className="nc-spray-can-shadow" aria-hidden="true" />
      <span className="nc-spray-can-shaker" aria-hidden="true">
        <span className="nc-spray-can-model">
          <span className="nc-spray-can-inner" />
          {faces.map((face, side) => <span className="nc-spray-can-face" key={side} style={face} />)}
          <span className="nc-spray-can-shoulder" />
          <span className="nc-spray-can-collar" />
          <span className="nc-spray-can-nozzle" />
        </span>
      </span>
    </button>)}
  </div>;
}
