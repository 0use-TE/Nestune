import { userRoute } from '@/server/guard';
import { collected, libraryOrder, saveLibraryOrder } from '@/server/collections';
import { body } from '@/server/http';

export const GET = userRoute((_req, _ctx, user) => ({ items: collected(user.id), order: libraryOrder(user.id) }));

export const PUT = userRoute(async (req, _ctx, user) => {
  const input = await body<{ order?: unknown } | null>(req, 64 * 1024);
  return { order: saveLibraryOrder(user.id, input?.order) };
});
