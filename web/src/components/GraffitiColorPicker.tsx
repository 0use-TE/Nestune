'use client';

import { useState, type PointerEvent } from 'react';
import { PAINT_CARDS, PAINT_SCHEMES, paintFromRgb, paintHex, paintRgb, randomPaintCard, schemeColors, type PaintColor } from '@/lib/graffiti-paint';
const channels = ['R', 'G', 'B'] as const;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

function swatches(colors: readonly string[]) {
  return <span className="nc-graffiti-swatches" aria-hidden="true">
    {colors.map((hex, index) => <i key={index} style={{ background: hex }} />)}
  </span>;
}

function huePosition(hue: number) {
  const angle = hue * Math.PI / 180;
  return { left: `${50 + Math.sin(angle) * 43}%`, top: `${50 - Math.cos(angle) * 43}%` };
}

export function GraffitiPaintCards({ onApply }: { onApply: (colors: readonly string[]) => void }) {
  const [randomCard, setRandomCard] = useState<ReturnType<typeof randomPaintCard> | null>(null);
  return <div className="nc-graffiti-card-list" role="group" aria-label="喷漆色卡">
    {PAINT_CARDS.map(card => <button className="nc-graffiti-card" type="button" key={card.name} onClick={() => onApply(card.colors)}>
      {swatches(card.colors)}<span>{card.name}</span>
    </button>)}
    {randomCard && <button className="nc-graffiti-card" type="button" onClick={() => onApply(randomCard.colors)}>
      {swatches(randomCard.colors)}<span>{randomCard.name}</span>
    </button>}
    <button className="btn ghost sm nc-graffiti-random-card" type="button" onClick={() => {
      const card = randomPaintCard();
      setRandomCard(card);
      onApply(card.colors);
    }}>随机抽色卡</button>
  </div>;
}

export function GraffitiColorPicker({ color, selectedCan, onChange, onApply }: {
  color: PaintColor; selectedCan: number; onChange: (next: PaintColor) => void; onApply: (colors: readonly string[]) => void;
}) {
  const [schemeIndex, setSchemeIndex] = useState(0);
  const scheme = PAINT_SCHEMES[schemeIndex];
  const colors = schemeColors(color.hue, scheme);
  const offset = (scheme.offsets.indexOf(0) - selectedCan + colors.length) % colors.length;
  const palette = [...colors.slice(offset), ...colors.slice(0, offset)];
  const rgb = paintRgb(color);

  function chooseShade(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange({
      ...color,
      saturation: clamp((event.clientX - rect.x) / rect.width, 0, 1),
      value: 1 - clamp((event.clientY - rect.y) / rect.height, 0, 1),
    });
  }
  function chooseHue(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
    const hue = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    onChange({ ...color, hue, saturation: color.saturation || .75, value: color.value || .85 });
  }
  return <div className="nc-graffiti-color-picker" role="group" aria-label="自定义喷漆颜色">
    <div className="nc-graffiti-wheel">
      <div className="nc-graffiti-hue-ring" aria-label="色相转盘" role="slider" tabIndex={0}
        aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.floor(color.hue)}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          chooseHue(event);
        }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) chooseHue(event); }}
        onKeyDown={event => {
          const step = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
          if (!step) return;
          event.preventDefault();
          onChange({ ...color, hue: (color.hue + step + 360) % 360 });
        }}>
        {[...new Set(scheme.offsets)].filter(offset => offset !== 0).map(offset =>
          <i key={offset} aria-hidden="true" style={huePosition(color.hue + offset)} />)}
        <i className="is-current" aria-hidden="true" style={huePosition(color.hue)} />
      </div>
      <div className="nc-graffiti-color-center">
        <div className="nc-graffiti-color-field" tabIndex={0} role="group" aria-label="饱和度和明度，方向键调整"
          style={{ backgroundColor: `hsl(${color.hue} 100% 50%)` }}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            chooseShade(event);
          }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) chooseShade(event); }}
          onKeyDown={event => {
            const ds = event.key === 'ArrowLeft' ? -.025 : event.key === 'ArrowRight' ? .025 : 0;
            const dv = event.key === 'ArrowDown' ? -.025 : event.key === 'ArrowUp' ? .025 : 0;
            if (ds || dv) {
              event.preventDefault();
              onChange({ ...color, saturation: clamp(color.saturation + ds, 0, 1), value: clamp(color.value + dv, 0, 1) });
            }
          }}>
          <span aria-hidden="true" style={{ left: `${color.saturation * 100}%`, top: `${(1 - color.value) * 100}%`, background: paintHex(color) }} />
        </div>
      </div>
    </div>
    <div className="nc-graffiti-color-controls">
      <label className="nc-graffiti-range">色相
        <input type="range" min="0" max="359" value={Math.floor(color.hue)}
          onChange={event => onChange({ ...color, hue: Number(event.target.value) })} />
      </label>
      <div className="nc-graffiti-rgb" role="group" aria-label="RGB 数值">
        {channels.map((channel, index) => <label key={channel}>{channel}
          <input type="number" inputMode="numeric" min="0" max="255" value={rgb[index]}
            onChange={event => {
              const next = rgb.slice();
              next[index] = clamp(Math.round(Number(event.target.value) || 0), 0, 255);
              onChange(paintFromRgb(next, color.hue));
            }} />
        </label>)}
      </div>
      <output className="nc-graffiti-color-output" aria-label="十六进制颜色">
        <i style={{ background: paintHex(color) }} />{paintHex(color).toUpperCase()}
      </output>
      <label className="nc-graffiti-range">配色规则<select value={schemeIndex} onChange={event => setSchemeIndex(Number(event.target.value))}>
        {PAINT_SCHEMES.map((option, index) => <option value={index} key={option.name}>{option.name}</option>)}
      </select></label>
      <button className="btn ghost sm nc-graffiti-apply-palette" type="button" onClick={() => onApply(palette)}>
        {swatches(palette)}套用配色
      </button>
    </div>
  </div>;
}
