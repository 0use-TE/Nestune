import { saveSettings, settings } from '@/server/db';
import { body, fail } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { evict } from '@/server/media';

export const GET = adminRoute(() => settings());

export const PATCH = adminRoute(async req => {
  try {
    const next = saveSettings(await body(req));
    evict();
    return next;
  } catch (e) {
    if (e instanceof Error && e.message === '设置值无效') throw fail(400, e.message);
    throw e;
  }
});
