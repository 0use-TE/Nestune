import { readCanvas } from '@/server/canvas';
import { saveCanvasSettings } from '@/server/canvas-settings';
import { adminRoute } from '@/server/guard';
import { body } from '@/server/http';
import { isCanvasGraffiti } from '@/lib/canvas-types';

export const GET = adminRoute(() => {
  const { records, settings } = readCanvas();
  return { settings, objectCount: records.filter(item => !isCanvasGraffiti(item)).length };
});

export const PUT = adminRoute(async req => saveCanvasSettings(await body(req)));
