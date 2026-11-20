'use client';

import { useEffect, useState } from 'react';
import { api, put } from '@/lib/api';
import { CANVAS_OBJECT_LIMIT, CANVAS_WALLPAPERS, DEFAULT_CANVAS_SETTINGS, MAX_CANVAS_ZOOM_LIMIT_PERCENT, MIN_CANVAS_ZOOM_LIMIT_PERCENT, type CanvasSettings, type CanvasWallpaper } from '@/lib/canvas-settings';
import { Loading } from './Loading';

type CanvasAdminData = { settings: CanvasSettings; objectCount: number };
type NumberField = 'personalLimit' | 'totalLimit' | 'zoomLimitPercent';
type Draft = Omit<CanvasSettings, NumberField> & Record<NumberField, string>;
const makeDraft = (settings: CanvasSettings): Draft => ({
  ...settings, personalLimit: String(settings.personalLimit), totalLimit: String(settings.totalLimit),
  zoomLimitPercent: String(settings.zoomLimitPercent ?? DEFAULT_CANVAS_SETTINGS.zoomLimitPercent),
});
const wallpapers = Object.keys(CANVAS_WALLPAPERS) as CanvasWallpaper[];

export function CanvasAdmin({ guard, toast }: { guard: (error: unknown) => void; toast: (message: string) => void }) {
  const [data, setData] = useState<CanvasAdminData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<CanvasAdminData>('/api/admin/canvas', { signal: controller.signal }).then(value => {
      setData(value);
      setDraft(makeDraft(value.settings));
    }).catch(error => { if (!controller.signal.aborted) guard(error); });
    return () => controller.abort();
  }, [guard]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !draft) return;
    setSaving(true);
    try {
      const settings = await put<CanvasSettings>('/api/admin/canvas', {
        ...draft, personalLimit: Number(draft.personalLimit), totalLimit: Number(draft.totalLimit),
        zoomLimitPercent: Number(draft.zoomLimitPercent),
      });
      setDraft(makeDraft(settings));
      setData(previous => previous && { ...previous, settings });
      toast('画布设置已保存');
    } catch (error) { guard(error); }
    finally { setSaving(false); }
  }

  return <>
    <div className="head"><div><h1>画布管理</h1><div className="sub">保存后对所有用户的共享画布生效。</div></div></div>
    {!data || !draft ? <Loading /> : <form onSubmit={save}>
      <div className="box pad">
        <h2>物品数量</h2>
        <p className="sub">当前共有 {data.objectCount} 件物品。调低上限后，已有物品会保留。</p>
        <div className="adm-canvas-limits">
          <label className="field">每人最多放置
            <input type="number" required min={1} max={Number(draft.totalLimit) || CANVAS_OBJECT_LIMIT} value={draft.personalLimit}
              disabled={saving} onChange={event => setDraft({ ...draft, personalLimit: event.target.value })} />
          </label>
          <label className="field">整个画布最多放置
            <input type="number" required min={1} max={CANVAS_OBJECT_LIMIT} value={draft.totalLimit}
              disabled={saving} onChange={event => setDraft({ ...draft, totalLimit: event.target.value })} />
          </label>
        </div>
      </div>
      <div className="box pad">
        <h2>画布视角</h2>
        <div className="adm-canvas-limits">
          <label className="field">最大缩放比例（%）
            <input type="number" required min={MIN_CANVAS_ZOOM_LIMIT_PERCENT} max={MAX_CANVAS_ZOOM_LIMIT_PERCENT}
              value={draft.zoomLimitPercent} disabled={saving}
              onChange={event => setDraft({ ...draft, zoomLimitPercent: event.target.value })} />
          </label>
        </div>
      </div>
      <div className="box pad">
        <fieldset className="adm-canvas-wallpapers">
          <legend>画布壁纸</legend>
          {wallpapers.map(id => {
            const wall = CANVAS_WALLPAPERS[id];
            return <label className="adm-canvas-wallpaper" key={id}>
              <span aria-hidden="true" style={{ backgroundColor: wall.color, backgroundImage: wall.image ? `url(${wall.image})` : undefined }} />
              <span><input type="radio" name="wallpaper" value={id} checked={draft.wallpaper === id} disabled={saving}
                onChange={() => setDraft({ ...draft, wallpaper: id })} />{wall.name}</span>
            </label>;
          })}
        </fieldset>
      </div>
      <div className="box pad">
        <h2>涂鸦</h2>
        <label className="adm-canvas-toggle">
          <input type="checkbox" checked={draft.allowGraffiti} disabled={saving}
            onChange={event => setDraft({ ...draft, allowGraffiti: event.target.checked })} />
          允许发布涂鸦
        </label>
        <p className="sub">关闭后，已有的墙面涂鸦仍然可见。</p>
      </div>
      <button className="btn" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存画布设置'}</button>
    </form>}
  </>;
}
