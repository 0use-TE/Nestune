import { userRoute } from '@/server/guard';
import { isCanvasMusic } from '@/lib/canvas-types';
import { body, fail } from '@/server/http';
import { addCanvasTool, addRecord, moveRecord, readCanvas, removeRecord, takeCanvasItem, resolveCanvasMusic } from '@/server/canvas';
import { readCanvasSync } from '@/server/canvas-sync';

export const runtime = 'nodejs';
const update = async (req: Request, owner: number) => {
  const input = await body<Record<string, unknown>>(req);
  if (input.action === 'add') return addRecord(owner, input);
  if (input.action === 'tool') return addCanvasTool(owner, input);
  if (input.action === 'take') return takeCanvasItem(owner, input.id, item => {
    if (input.capacity === undefined) return;
    if (!Number.isInteger(input.capacity) || (input.capacity as number) < 0 || (input.capacity as number) > 500) throw fail(400, '播放列表容量无效');
    if (!isCanvasMusic(item)) throw fail(400, '这个物件不能播放');
    if ((item.tracks ?? [item.song]).filter(song => song.access?.playable !== false).length > (input.capacity as number)) throw fail(400, '播放列表最多 500 首，请先移除一些歌曲');
  });
  if (input.action === 'resolve') return resolveCanvasMusic(owner, input);
  if (input.action === 'move') return moveRecord(owner, input);
  if (input.action === 'remove') return removeRecord(owner, input.id);
  throw fail(400, '无效的画布操作');
};
export const GET = userRoute(req => req.nextUrl.searchParams.get('sync') === '1'
  ? readCanvasSync(req.nextUrl.searchParams.get('since')) : readCanvas());
export const POST = userRoute((req, _ctx, user) => update(req, user.id));
