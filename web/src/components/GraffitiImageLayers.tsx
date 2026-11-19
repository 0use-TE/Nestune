'use client';

import { useEffect, useRef, useState } from 'react';
import {
  autoStencilLayers, stencilColorPreview, type StencilColorLayer, type StencilImage,
} from '@/lib/graffiti-image';

export function GraffitiSourcePreview({ pixels }: { pixels: ImageData }) {
  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    preview.current?.getContext('2d')?.putImageData(pixels, 0, 0);
  }, [pixels]);
  return <figure className="nc-graffiti-source-preview">
    <canvas ref={preview} width={pixels.width} height={pixels.height} aria-label="导入图预览" />
    <figcaption>{pixels.width} × {pixels.height} 像素</figcaption>
  </figure>;
}

export function GraffitiImageLayerColors({ layers, selected, painted, onSelect }: {
  layers: StencilColorLayer[];
  selected: number;
  painted?: ReadonlySet<number>;
  onSelect: (index: number) => void;
}) {
  return <div className="nc-graffiti-text-presets" role="group" aria-label="图片颜色层">
    {layers.map((layer, index) => {
      const complete = painted?.has(index);
      const status = layer.hidden ? '留空' : complete ? '已喷涂' : '';
      return <button className={`chip nc-graffiti-pass ${selected === index ? 'on' : ''}`} key={index} type="button"
        aria-label={`颜色层 ${index + 1}${layer.hidden ? '，已留空' : complete ? '，已喷涂' : ''}`}
        aria-pressed={selected === index} disabled={complete} onClick={() => onSelect(index)}>
        <i aria-hidden="true" style={{ background: layer.paint }} />{index + 1}{status && ` · ${status}`}
      </button>;
    })}
  </div>;
}

export function GraffitiLayerPaintButton({ paint, onPick }: { paint?: string; onPick: (hex: string) => void }) {
  return <button className="chip nc-graffiti-image-pick" type="button" disabled={!paint}
    onClick={() => { if (paint) onPick(paint); }}>给当前罐取色</button>;
}

export function GraffitiImageLayers({ image, assignments, onChange, onPickPaint }: {
  image: StencilImage;
  assignments: Uint8Array;
  onChange: (next: StencilImage) => void;
  onPickPaint: (hex: string) => void;
}) {
  const { pixels, layers, selected, range, background } = image;
  const [pickTarget, setPickTarget] = useState<'sample' | 'background' | null>(null);
  const source = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const active = layers[selected];
  const thumbScale = Math.min(100 / pixels.width, 58 / pixels.height);
  const thumbStyle = { width: Math.max(1, pixels.width * thumbScale), height: Math.max(1, pixels.height * thumbScale) };

  useEffect(() => {
    source.current?.getContext('2d')?.putImageData(pixels, 0, 0);
  }, [pixels]);

  useEffect(() => {
    preview.current?.getContext('2d')?.putImageData(stencilColorPreview(pixels, assignments, layers), 0, 0);
  }, [pixels, assignments, layers]);

  function updateLayer(patch: Partial<StencilColorLayer>) {
    onChange({ ...image, layers: layers.map((layer, index) => index === selected ? { ...layer, ...patch } : layer) });
  }

  function auto(count: number) {
    setPickTarget(null);
    onChange({ ...image, layers: autoStencilLayers(pixels, count), selected: 0, range: 100, background: null });
  }

  return <div className="nc-graffiti-image-layers">
    <div className="nc-graffiti-layer-tools">
      <div className="nc-graffiti-text-presets" role="group" aria-label="图片分层">
        <button className="chip" type="button" onClick={() => auto(Math.max(2, layers.length))}>自动分层</button>
        <label className="nc-graffiti-range">自动色数<select aria-label="自动色数" value={Math.max(2, layers.length)}
          onChange={event => auto(Number(event.target.value))}>
          {[2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count} 色</option>)}
        </select></label>
      </div>
      <GraffitiImageLayerColors layers={layers} selected={selected} onSelect={index => {
        setPickTarget(null);
        onChange({ ...image, selected: index });
      }} />
      <GraffitiLayerPaintButton paint={active?.paint} onPick={hex => {
        setPickTarget(null);
        onPickPaint(hex);
      }} />
      <details className="nc-graffiti-layer-settings">
        <summary>分色设置</summary>
        <div className="nc-graffiti-text-presets">
          <label className="nc-graffiti-range">匹配范围<input type="range" min="5" max="100" value={range}
            onChange={event => onChange({ ...image, range: Number(event.target.value) })} /><output>{range}</output></label>
          {active && <>
            <label className="nc-graffiti-range">取样色<input type="color" value={active.sample}
              onChange={event => updateLayer({ sample: event.target.value })} /></label>
            <label className="nc-graffiti-range">预览色<input type="color" value={active.paint}
              onChange={event => updateLayer({ paint: event.target.value })} /></label>
            <label className="nc-graffiti-range"><input type="checkbox" checked={!!active.hidden}
              onChange={event => updateLayer({ hidden: event.target.checked })} />此层留空</label>
          </>}
          {active && <button className={`chip ${pickTarget === 'sample' ? 'on' : ''}`} type="button" aria-pressed={pickTarget === 'sample'}
            onClick={() => setPickTarget(pickTarget === 'sample' ? null : 'sample')}>选图层取样色</button>}
          <button className={`chip ${pickTarget === 'background' ? 'on' : ''}`} type="button" aria-pressed={pickTarget === 'background'}
            onClick={() => setPickTarget(pickTarget === 'background' ? null : 'background')}>选背景色</button>
          {background && <button className="chip nc-graffiti-pass" type="button"
            onClick={() => onChange({ ...image, background: null })}><i aria-hidden="true" style={{ background }} />恢复背景色</button>}
        </div>
      </details>
    </div>
    <div className="nc-graffiti-image-previews">
      <figure>
        <button type="button" disabled={pickTarget === null}
          aria-label={pickTarget === 'background' ? '从原图取背景色' : pickTarget === 'sample' ? '从原图取图层样色' : '原图预览'}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const u = event.detail ? (event.clientX - rect.left) / rect.width : .5;
            const v = event.detail ? (event.clientY - rect.top) / rect.height : .5;
            const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(u * pixels.width)));
            const y = Math.max(0, Math.min(pixels.height - 1, Math.floor(v * pixels.height)));
            const index = (y * pixels.width + x) * 4;
            if (pixels.data[index + 3] < 128) return;
            const hex = '#' + [...pixels.data.subarray(index, index + 3)].map(value => value.toString(16).padStart(2, '0')).join('');
            if (pickTarget === 'background') {
              onChange({ ...image, background: hex });
            } else if (pickTarget === 'sample') {
              updateLayer({ sample: hex });
            }
            setPickTarget(null);
          }}><canvas ref={source} width={pixels.width} height={pixels.height} style={thumbStyle} /></button>
        <figcaption>{pickTarget === 'background' ? '点原图选背景' : pickTarget === 'sample' ? '点原图选分色' : '原图'}</figcaption>
      </figure>
      <figure>
        <canvas ref={preview} width={pixels.width} height={pixels.height} style={thumbStyle} aria-label="分色预览" />
        <figcaption>分色预览</figcaption>
      </figure>
    </div>
  </div>;
}
